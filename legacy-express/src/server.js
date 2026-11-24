import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { db } from './db.js';
import { providers, DRY_RUN } from './providers/index.js';
import { authRouter, connectorInfo } from './oauth.js';
import { listAccounts, getAccount, upsertAccount, removeAccount, publicAccount } from './accounts.js';
import { startScheduler } from './scheduler.js';

fs.mkdirSync('uploads', { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads',
    filename: (_req, file, cb) =>
      cb(null, crypto.randomBytes(8).toString('hex') + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 512 * 1024 * 1024 },
});

const app = express();
app.use(express.json());
app.use(express.static('public'));
app.use('/media', express.static('uploads'));
app.use('/auth', authRouter);

const mediaTypeOf = (file) =>
  !file ? null : file.mimetype.startsWith('video/') ? 'video' : file.mimetype.startsWith('image/') ? 'image' : null;

function loadPosts(where = '', ...args) {
  const posts = db.prepare(`SELECT * FROM posts ${where} ORDER BY scheduled_at`).all(...args);
  const targets = db.prepare(`SELECT t.*, a.name AS account_name FROM targets t
    LEFT JOIN accounts a ON a.id = t.account_id WHERE t.post_id = ?`);
  return posts.map((p) => ({ ...p, targets: targets.all(p.id) }));
}

app.get('/api/status', (_req, res) => res.json({ dryRun: DRY_RUN }));

// ---- accounts ----
app.get('/api/accounts', (_req, res) =>
  res.json({ accounts: listAccounts().map(publicAccount), connectors: connectorInfo() }));

app.delete('/api/accounts/:id', (req, res) => {
  removeAccount(req.params.id);
  res.status(204).end();
});

// dry-run only: fake accounts so you can try the UI without any developer apps
app.post('/api/accounts/demo', (_req, res) => {
  if (!DRY_RUN) return res.status(400).json({ error: 'Demo accounts only exist in dry-run mode' });
  for (const platform of Object.keys(providers))
    upsertAccount({ platform, external_id: 'demo', name: `Demo ${platform}`, access_token: 'demo' });
  res.status(201).end();
});

app.get('/api/posts', (_req, res) => res.json(loadPosts()));

app.post('/api/posts', upload.single('media'), (req, res) => {
  const caption = (req.body.caption || '').trim();
  const accounts = (req.body.accounts || '').split(',').filter(Boolean).map((id) => getAccount(id));
  const when = new Date(req.body.scheduledAt);
  const mediaType = mediaTypeOf(req.file);

  const fail = (msg) => {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: msg });
  };
  if (isNaN(when)) return fail('Invalid date');
  if (!accounts.length) return fail('Pick at least one account');
  if (accounts.some((a) => !a)) return fail('Unknown account');
  if (req.file && !mediaType) return fail('Media must be an image or video');
  for (const a of accounts) {
    const err = providers[a.platform].validate({ caption, mediaType });
    if (err) return fail(`${a.name}: ${err}`);
  }

  const iso = when.toISOString();
  const { lastInsertRowid: id } = db
    .prepare(`INSERT INTO posts (caption, media_file, media_type, scheduled_at) VALUES (?,?,?,?)`)
    .run(caption, req.file?.filename ?? null, mediaType, iso);
  const ins = db.prepare(`INSERT INTO targets (post_id, account_id, platform, run_at) VALUES (?,?,?,?)`);
  for (const a of accounts) ins.run(id, a.id, a.platform, iso);
  res.status(201).json(loadPosts('WHERE id = ?', id)[0]);
});

// reschedule (only targets that haven't gone out yet)
app.patch('/api/posts/:id', (req, res) => {
  const when = new Date(req.body.scheduledAt);
  if (isNaN(when)) return res.status(400).json({ error: 'Invalid date' });
  const iso = when.toISOString();
  db.prepare(`UPDATE posts SET scheduled_at=? WHERE id=?`).run(iso, req.params.id);
  db.prepare(`UPDATE targets SET run_at=?, attempts=0, error=NULL, status='scheduled'
              WHERE post_id=? AND status IN ('scheduled','failed')`).run(iso, req.params.id);
  res.json(loadPosts('WHERE id = ?', req.params.id)[0]);
});

app.post('/api/posts/:id/retry', (req, res) => {
  db.prepare(`UPDATE targets SET status='scheduled', attempts=0, error=NULL, run_at=?
              WHERE post_id=? AND status='failed'`).run(new Date().toISOString(), req.params.id);
  res.json(loadPosts('WHERE id = ?', req.params.id)[0]);
});

app.delete('/api/posts/:id', (req, res) => {
  const post = db.prepare(`SELECT media_file FROM posts WHERE id=?`).get(req.params.id);
  if (post?.media_file) fs.unlink(path.join('uploads', post.media_file), () => {});
  db.prepare(`DELETE FROM posts WHERE id=?`).run(req.params.id);
  res.status(204).end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PostPilot on http://localhost:${PORT}  ${DRY_RUN ? '(DRY RUN — nothing is really posted)' : '(LIVE)'}`);
  startScheduler();
});
