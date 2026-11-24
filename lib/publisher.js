// Core publish logic, used by the Lambda (production) and the local poller (dev).
import * as store from './store.js';
import { publishTo } from './providers/index.js';
import { scheduleTarget } from './scheduling.js';
import { mediaBaseUrl } from './env.js';

const MAX_ATTEMPTS = 3;
const STUCK_AFTER_MS = 20 * 60_000; // a Lambda run never lasts this long, so the claim is dead

export async function publishTarget(targetId) {
  const now = new Date().toISOString();
  if (!(await store.claimTarget(targetId, now))) return 'skipped'; // already published / claimed / deleted

  const t = await store.getTarget(targetId);
  try {
    const post = await store.getPost(t.postId);
    if (!post) throw new Error('Post was deleted');
    const account = t.accountId ? await store.getAccount(t.accountId) : null;
    const { id } = await publishTo(
      t.platform,
      {
        caption: post.caption,
        mediaType: post.mediaType,
        mediaUrl: post.mediaKey ? `${mediaBaseUrl()}/${post.mediaKey}` : null,
      },
      account
    );
    await store.updateTarget(t.id, {
      status: 'published', error: null, remoteId: id, attempts: t.attempts + 1, publishedAt: new Date().toISOString(),
    });
    console.log(`published ${t.platform} target ${t.id} (${id})`);
    return 'published';
  } catch (err) {
    const attempts = t.attempts + 1;
    const message = String(err.message || err);
    console.error(`${t.platform} target ${t.id} attempt ${attempts} failed: ${message}`);
    if (attempts >= MAX_ATTEMPTS) {
      await store.updateTarget(t.id, { status: 'failed', error: message, attempts });
      return 'failed';
    }
    // retry with backoff: 2, then 4 minutes
    const runAt = new Date(Date.now() + 2 ** attempts * 60_000).toISOString();
    const next = { ...t, runAt, attempts };
    let scheduleName = null;
    try {
      scheduleName = await scheduleTarget(next);
    } catch (e) {
      console.error('could not schedule retry (the hourly sweep will pick it up):', e.message);
    }
    await store.updateTarget(t.id, { status: 'scheduled', error: message, attempts, runAt, scheduleName });
    return 'retry';
  }
}

/** Safety net: publish everything overdue, and release claims from crashed runs. */
export async function sweep() {
  const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  for (const t of await store.stuckTargets(stuckBefore)) await store.updateTarget(t.id, { status: 'scheduled' });

  const results = {};
  for (const t of await store.dueTargets(new Date().toISOString())) {
    const r = await publishTarget(t.id);
    results[r] = (results[r] || 0) + 1;
  }
  return results;
}
