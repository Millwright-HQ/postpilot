// App-level operations used by the API routes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import { providers } from './providers/index.js';
import { scheduleTarget, unschedule } from './scheduling.js';
import { LOCAL, awsConfig, mediaBaseUrl } from './env.js';

export const publicAccount = (a) => ({
  id: a.id,
  platform: a.platform,
  name: a.name,
  needsReconnect: !!a.expiresAt && !a.refreshToken && new Date(a.expiresAt) < new Date(),
});

export async function listPostsView() {
  const [posts, targets, accounts] = await Promise.all([store.listPosts(), store.listTargets(), store.listAccounts()]);
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  return posts
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .map((p) => ({
      ...p,
      mediaUrl: p.mediaKey ? `${mediaBaseUrl()}/${p.mediaKey}` : null,
      targets: targets
        .filter((t) => t.postId === p.id)
        .map(({ scheduleName, claimedAt, ...t }) => ({ ...t, accountName: names[t.accountId] ?? null })),
    }));
}

async function postView(id) {
  return (await listPostsView()).find((p) => p.id === id);
}

export async function createPost({ caption = '', accountIds = [], scheduledAt, mediaKey = null, mediaType = null }) {
  caption = String(caption).trim();
  const when = new Date(scheduledAt);
  if (isNaN(when)) throw new HttpError(400, 'Invalid date');
  if (!accountIds.length) throw new HttpError(400, 'Pick at least one account');
  if (mediaKey && !/^media\/[\w.-]+$/.test(mediaKey)) throw new HttpError(400, 'Bad media key');
  if (mediaKey && !['image', 'video'].includes(mediaType)) throw new HttpError(400, 'Media must be an image or video');
  if (!mediaKey) mediaType = null;

  const accounts = await Promise.all(accountIds.map((id) => store.getAccount(id)));
  if (accounts.some((a) => !a)) throw new HttpError(400, 'Unknown account');
  for (const a of accounts) {
    const err = providers[a.platform].validate({ caption, mediaType });
    if (err) throw new HttpError(400, `${a.name}: ${err}`);
  }

  const runAt = when.toISOString();
  const postId = crypto.randomUUID();
  await store.putPost({ id: postId, caption, mediaKey, mediaType, scheduledAt: runAt, createdAt: new Date().toISOString() });
  for (const a of accounts) {
    const target = {
      id: crypto.randomUUID(), postId, accountId: a.id, platform: a.platform,
      status: 'scheduled', runAt, attempts: 0,
    };
    await store.putTarget(target);
    try {
      const scheduleName = await scheduleTarget(target);
      if (scheduleName) await store.updateTarget(target.id, { scheduleName });
    } catch (e) {
      // not fatal: the hourly sweep still publishes it, just late
      console.error('schedule creation failed:', e.message);
    }
  }
  return postView(postId);
}

export async function reschedulePost(id, scheduledAt) {
  const when = new Date(scheduledAt);
  if (isNaN(when)) throw new HttpError(400, 'Invalid date');
  const runAt = when.toISOString();
  await store.updatePost(id, { scheduledAt: runAt });
  for (const t of await store.targetsByPost(id)) {
    if (!['scheduled', 'failed'].includes(t.status)) continue;
    await unschedule(t.scheduleName);
    const next = { ...t, runAt, attempts: 0, status: 'scheduled' };
    const scheduleName = await scheduleTarget(next).catch(() => null);
    await store.updateTarget(t.id, { runAt, attempts: 0, error: null, status: 'scheduled', scheduleName: scheduleName ?? null });
  }
  return postView(id);
}

export async function retryPost(id) {
  const runAt = new Date().toISOString();
  for (const t of await store.targetsByPost(id)) {
    if (t.status !== 'failed') continue;
    const next = { ...t, runAt, attempts: 0, status: 'scheduled' };
    const scheduleName = await scheduleTarget(next).catch(() => null);
    await store.updateTarget(t.id, { status: 'scheduled', runAt, attempts: 0, error: null, scheduleName: scheduleName ?? null });
  }
  return postView(id);
}

export async function deletePost(id) {
  const post = await store.getPost(id);
  for (const t of await store.targetsByPost(id)) await unschedule(t.scheduleName);
  await store.deletePost(id);
  if (post?.mediaKey) await deleteMedia(post.mediaKey).catch(() => {});
}

export async function disconnectAccount(id) {
  for (const t of await store.listTargets()) {
    if (t.accountId === id && t.status === 'scheduled') {
      await unschedule(t.scheduleName);
      await store.updateTarget(t.id, { status: 'failed', error: 'Account disconnected' });
    }
  }
  await store.deleteAccount(id);
}

// ---- media ----
export const LOCAL_MEDIA_DIR = path.resolve('data/media');

export async function createUpload({ filename = '', contentType = '' }) {
  const type = contentType.startsWith('video/') ? 'video' : contentType.startsWith('image/') ? 'image' : null;
  if (!type) throw new HttpError(400, 'Media must be an image or video');
  const ext = (path.extname(filename).toLowerCase().replace(/[^.\w]/g, '') || '').slice(0, 8);
  const key = `media/${crypto.randomUUID()}${ext}`;
  if (LOCAL) return { key, mediaType: type, uploadUrl: `/api/local-upload?key=${encodeURIComponent(key)}` };

  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
  const uploadUrl = await getSignedUrl(
    new S3Client(awsConfig()),
    new PutObjectCommand({ Bucket: process.env.MEDIA_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 900 }
  );
  return { key, mediaType: type, uploadUrl };
}

async function deleteMedia(key) {
  if (LOCAL) return fs.promises.unlink(path.join(LOCAL_MEDIA_DIR, path.basename(key)));
  const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  await new S3Client(awsConfig()).send(new DeleteObjectCommand({ Bucket: process.env.MEDIA_BUCKET, Key: key }));
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const fail = (e) =>
  Response.json({ error: e.message || 'Server error' }, { status: e.status || 500 });
