import path from 'node:path';
import { db } from './db.js';
import { publishTo } from './providers/index.js';
import { getAccount } from './accounts.js';

const MAX_ATTEMPTS = 3;
const TICK_MS = 15_000;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const due = db.prepare(`
  SELECT t.id, t.platform, t.account_id, t.attempts, p.caption, p.media_file, p.media_type
  FROM targets t JOIN posts p ON p.id = t.post_id
  WHERE t.status = 'scheduled' AND t.run_at <= ?
  ORDER BY t.run_at LIMIT 10`);
const mark = db.prepare(`UPDATE targets SET status=?, error=?, remote_id=?, attempts=?, run_at=?, published_at=? WHERE id=?`);

let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const now = new Date().toISOString();
    for (const t of due.all(now)) {
      mark.run('publishing', null, null, t.attempts, now, null, t.id);
      const post = {
        caption: t.caption,
        mediaType: t.media_type,
        mediaUrl: t.media_file ? `${PUBLIC_BASE_URL}/media/${t.media_file}` : null,
        filePath: t.media_file ? path.resolve('uploads', t.media_file) : null,
      };
      try {
        const { id } = await publishTo(t.platform, post, t.account_id ? getAccount(t.account_id) : null);
        mark.run('published', null, id, t.attempts + 1, now, new Date().toISOString(), t.id);
        console.log(`✔ ${t.platform} target ${t.id} published (${id})`);
      } catch (err) {
        const attempts = t.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        // exponential backoff: 2, 4 minutes
        const next = new Date(Date.now() + 2 ** attempts * 60_000).toISOString();
        mark.run(failed ? 'failed' : 'scheduled', String(err.message || err), null, attempts, next, null, t.id);
        console.error(`✘ ${t.platform} target ${t.id} attempt ${attempts}: ${err.message}`);
      }
    }
  } finally {
    running = false;
  }
}

export function startScheduler() {
  tick();
  setInterval(tick, TICK_MS);
  console.log(`Scheduler running (checks every ${TICK_MS / 1000}s)`);
}
