// Production store: DynamoDB (tables + GSIs defined in infra/template.yaml).
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, ScanCommand, QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { awsConfig } from './env.js';

let _doc;
const doc = () => (_doc ??= DynamoDBDocumentClient.from(new DynamoDBClient(awsConfig()), {
  marshallOptions: { removeUndefinedValues: true },
}));
const TABLE = {
  accounts: () => process.env.ACCOUNTS_TABLE,
  posts: () => process.env.POSTS_TABLE,
  targets: () => process.env.TARGETS_TABLE,
};

const get = async (t, id) => (await doc().send(new GetCommand({ TableName: TABLE[t](), Key: { id } }))).Item ?? null;
const put = (t, item) => doc().send(new PutCommand({ TableName: TABLE[t](), Item: item }));
const del = (t, id) => doc().send(new DeleteCommand({ TableName: TABLE[t](), Key: { id } }));

async function scan(t) {
  const items = [];
  let key;
  do {
    const r = await doc().send(new ScanCommand({ TableName: TABLE[t](), ExclusiveStartKey: key }));
    items.push(...(r.Items ?? []));
    key = r.LastEvaluatedKey;
  } while (key);
  return items;
}

async function query(t, params) {
  const items = [];
  let key;
  do {
    const r = await doc().send(new QueryCommand({ TableName: TABLE[t](), ExclusiveStartKey: key, ...params }));
    items.push(...(r.Items ?? []));
    key = r.LastEvaluatedKey;
  } while (key);
  return items;
}

async function update(t, id, fields, extra = {}) {
  const names = {}, values = {}, sets = [];
  Object.entries(fields).forEach(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    sets.push(`#f${i} = :v${i}`);
  });
  const r = await doc().send(new UpdateCommand({
    TableName: TABLE[t](), Key: { id }, ReturnValues: 'ALL_NEW',
    UpdateExpression: `SET ${sets.join(', ')}`,
    ExpressionAttributeNames: { ...names, ...extra.names },
    ExpressionAttributeValues: { ...values, ...extra.values },
    ConditionExpression: extra.condition,
  }));
  return r.Attributes;
}

export const listAccounts = () => scan('accounts');
export const getAccount = (id) => get('accounts', id);
export const putAccount = (a) => put('accounts', a);
export const updateAccount = (id, f) => update('accounts', id, f);
export const deleteAccount = (id) => del('accounts', id);

export const putPost = (p) => put('posts', p);
export const listPosts = () => scan('posts');
export const getPost = (id) => get('posts', id);
export const updatePost = (id, f) => update('posts', id, f);
export const deletePost = async (id) => {
  for (const t of await targetsByPost(id)) await del('targets', t.id);
  await del('posts', id);
};

export const putTarget = (t) => put('targets', t);
export const getTarget = (id) => get('targets', id);
export const updateTarget = (id, f) => update('targets', id, f);
export const listTargets = () => scan('targets');
export const targetsByPost = (postId) =>
  query('targets', {
    IndexName: 'byPost',
    KeyConditionExpression: 'postId = :p',
    ExpressionAttributeValues: { ':p': postId },
  });
export const dueTargets = (now) =>
  query('targets', {
    IndexName: 'due',
    KeyConditionExpression: '#s = :s AND runAt <= :n',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': 'scheduled', ':n': now },
  });
export const stuckTargets = async (before) =>
  (await query('targets', {
    IndexName: 'due',
    KeyConditionExpression: '#s = :s',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':s': 'publishing' },
  })).filter((t) => (t.claimedAt ?? '') < before);

// atomic scheduled -> publishing, so overlapping invocations can never double-post
export async function claimTarget(id, now) {
  try {
    await update('targets', id, { status: 'publishing', claimedAt: now }, {
      condition: '#cs = :sched',
      names: { '#cs': 'status' },
      values: { ':sched': 'scheduled' },
    });
    return true;
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}
