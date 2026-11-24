import { db } from './db.js';

// Tokens never leave the server: the API only returns this safe shape.
export const publicAccount = (a) => ({
  id: a.id,
  platform: a.platform,
  name: a.name,
  needsReconnect: !!a.expires_at && !a.refresh_token && new Date(a.expires_at) < new Date(),
});

export const listAccounts = () => db.prepare(`SELECT * FROM accounts ORDER BY platform, name`).all();
export const getAccount = (id) => db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id);

export function upsertAccount({ platform, external_id, name, access_token, refresh_token = null, expires_at = null }) {
  db.prepare(`
    INSERT INTO accounts (platform, external_id, name, access_token, refresh_token, expires_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT (platform, external_id) DO UPDATE SET
      name = excluded.name,
      access_token = excluded.access_token,
      refresh_token = COALESCE(excluded.refresh_token, accounts.refresh_token),
      expires_at = excluded.expires_at`)
    .run(platform, String(external_id), name, access_token, refresh_token, expires_at);
}

export function updateTokens(id, { access_token, refresh_token, expires_at }) {
  db.prepare(`
    UPDATE accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ?
    WHERE id = ?`).run(access_token, refresh_token ?? null, expires_at ?? null, id);
  return getAccount(id);
}

export function removeAccount(id) {
  // anything still queued for this account can't be sent any more
  db.prepare(`UPDATE targets SET status='failed', error='Account disconnected'
              WHERE account_id = ? AND status = 'scheduled'`).run(id);
  db.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
}
