// Local-dev store: one JSON file. Same interface as store-dynamo.js.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve('data/store.json');
const read = () => {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { accounts: [], posts: [], targets: [] };
  }
};
const write = (d) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(d, null, 2));
};
const patch = (table, id, fields) => {
  const d = read();
  const row = d[table].find((r) => r.id === id);
  if (row) Object.assign(row, fields);
  write(d);
  return row;
};

export const listAccounts = async () => read().accounts;
export const getAccount = async (id) => read().accounts.find((a) => a.id === id) ?? null;
export const putAccount = async (a) => {
  const d = read();
  d.accounts.push(a);
  write(d);
};
export const updateAccount = async (id, f) => patch('accounts', id, f);
export const deleteAccount = async (id) => {
  const d = read();
  d.accounts = d.accounts.filter((a) => a.id !== id);
  write(d);
};

export const putPost = async (p) => {
  const d = read();
  d.posts.push(p);
  write(d);
};
export const listPosts = async () => read().posts;
export const getPost = async (id) => read().posts.find((p) => p.id === id) ?? null;
export const updatePost = async (id, f) => patch('posts', id, f);
export const deletePost = async (id) => {
  const d = read();
  d.posts = d.posts.filter((p) => p.id !== id);
  d.targets = d.targets.filter((t) => t.postId !== id);
  write(d);
};

export const putTarget = async (t) => {
  const d = read();
  d.targets.push(t);
  write(d);
};
export const getTarget = async (id) => read().targets.find((t) => t.id === id) ?? null;
export const updateTarget = async (id, f) => patch('targets', id, f);
export const listTargets = async () => read().targets;
export const targetsByPost = async (postId) => read().targets.filter((t) => t.postId === postId);
export const dueTargets = async (now) => read().targets.filter((t) => t.status === 'scheduled' && t.runAt <= now);
export const stuckTargets = async (before) =>
  read().targets.filter((t) => t.status === 'publishing' && (t.claimedAt ?? '') < before);
export const claimTarget = async (id, now) => {
  const d = read();
  const t = d.targets.find((x) => x.id === id);
  if (!t || t.status !== 'scheduled') return false;
  t.status = 'publishing';
  t.claimedAt = now;
  write(d);
  return true;
};
