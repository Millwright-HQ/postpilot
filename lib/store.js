import * as file from './store-file.js';
import * as dynamo from './store-dynamo.js';

const impl = process.env.STORE === 'file' ? file : dynamo;

export const {
  listAccounts, getAccount, putAccount, updateAccount, deleteAccount,
  putPost, listPosts, getPost, updatePost, deletePost,
  putTarget, getTarget, updateTarget, listTargets, targetsByPost, dueTargets, stuckTargets, claimTarget,
} = impl;
