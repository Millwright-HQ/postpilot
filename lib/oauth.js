// OAuth "Connect account" flows for Meta (Facebook + Instagram), Google (YouTube) and TikTok.
// Each connector builds the consent URL, then turns the returned ?code into account rows.
import crypto from 'node:crypto';
import * as store from './store.js';
import { publicBaseUrl } from './env.js';
import { sign, verify } from './session.js';

const env = (k) => process.env[k] || '';
const redirectUri = (id) => `${publicBaseUrl()}/auth/${id}/callback`;
const qs = (o) => new URLSearchParams(o).toString();
const inSeconds = (s) => new Date(Date.now() + s * 1000).toISOString();

async function http(url, opts) {
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error;
    throw new Error((typeof e === 'object' ? e?.message : json.error_description || e) || `HTTP ${res.status}`);
  }
  return json;
}

const G = 'https://graph.facebook.com/v21.0';

const connectors = {
  meta: {
    label: 'Facebook & Instagram',
    needs: ['META_APP_ID', 'META_APP_SECRET'],
    authUrl: (state) =>
      `https://www.facebook.com/v21.0/dialog/oauth?${qs({
        client_id: env('META_APP_ID'),
        redirect_uri: redirectUri('meta'),
        state,
        scope: 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish',
      })}`,
    async finish(code) {
      const common = { client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET') };
      const short = await http(`${G}/oauth/access_token?${qs({ ...common, redirect_uri: redirectUri('meta'), code })}`);
      const long = await http(
        `${G}/oauth/access_token?${qs({ ...common, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token })}`
      );
      // Page tokens obtained from a long-lived user token don't expire.
      const pages = await http(
        `${G}/me/accounts?${qs({
          fields: 'id,name,access_token,instagram_business_account{id,username}',
          limit: 100,
          access_token: long.access_token,
        })}`
      );
      if (!pages.data?.length)
        throw new Error('No Facebook Pages found. Tick your Page in the Facebook dialog and try again.');
      const out = [];
      for (const p of pages.data) {
        out.push({ platform: 'facebook', externalId: p.id, name: p.name, accessToken: p.access_token });
        const ig = p.instagram_business_account;
        if (ig) out.push({ platform: 'instagram', externalId: ig.id, name: `@${ig.username}`, accessToken: p.access_token });
      }
      return out;
    },
  },

  google: {
    label: 'YouTube',
    needs: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    authUrl: (state) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${qs({
        client_id: env('GOOGLE_CLIENT_ID'),
        redirect_uri: redirectUri('google'),
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
        access_type: 'offline', // gives us a refresh token
        prompt: 'consent', // ...every time, even on reconnect
        state,
      })}`,
    async finish(code) {
      const tok = await http('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          code,
          client_id: env('GOOGLE_CLIENT_ID'),
          client_secret: env('GOOGLE_CLIENT_SECRET'),
          redirect_uri: redirectUri('google'),
          grant_type: 'authorization_code',
        }),
      });
      const ch = await http('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      });
      const channel = ch.items?.[0];
      if (!channel) throw new Error('That Google account has no YouTube channel.');
      return [{
        platform: 'youtube',
        externalId: channel.id,
        name: channel.snippet.title,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: inSeconds(tok.expires_in),
      }];
    },
    refresh: (acct) =>
      http('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: env('GOOGLE_CLIENT_ID'),
          client_secret: env('GOOGLE_CLIENT_SECRET'),
          refresh_token: acct.refreshToken,
          grant_type: 'refresh_token',
        }),
      }).then((t) => ({ accessToken: t.access_token, expiresAt: inSeconds(t.expires_in) })),
  },

  tiktok: {
    label: 'TikTok',
    needs: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    authUrl: (state) =>
      `https://www.tiktok.com/v2/auth/authorize/?${qs({
        client_key: env('TIKTOK_CLIENT_KEY'),
        scope: 'user.info.basic,video.publish',
        response_type: 'code',
        redirect_uri: redirectUri('tiktok'),
        state,
      })}`,
    async finish(code) {
      const tok = await http('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: env('TIKTOK_CLIENT_KEY'),
          client_secret: env('TIKTOK_CLIENT_SECRET'),
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri('tiktok'),
        }),
      });
      let name = 'TikTok account';
      try {
        const u = await http('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
          headers: { Authorization: `Bearer ${tok.access_token}` },
        });
        name = u.data?.user?.display_name || name;
      } catch {}
      return [{
        platform: 'tiktok',
        externalId: tok.open_id,
        name,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: inSeconds(tok.expires_in),
      }];
    },
    refresh: (acct) =>
      http('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_key: env('TIKTOK_CLIENT_KEY'),
          client_secret: env('TIKTOK_CLIENT_SECRET'),
          grant_type: 'refresh_token',
          refresh_token: acct.refreshToken,
        }),
      }).then((t) => ({
        accessToken: t.access_token,
        refreshToken: t.refresh_token, // TikTok may rotate it
        expiresAt: inSeconds(t.expires_in),
      })),
  },
};

const connectorFor = { facebook: 'meta', instagram: 'meta', youtube: 'google', tiktok: 'tiktok' };

/** Providers call this before using an account: refreshes expiring tokens and saves them. */
export async function ensureFresh(account) {
  const c = connectors[connectorFor[account.platform]];
  if (!c?.refresh || !account.expiresAt) return account;
  if (new Date(account.expiresAt).getTime() - Date.now() > 120_000) return account;
  if (!account.refreshToken) throw new Error(`${account.name}: session expired, reconnect the account`);
  try {
    const fresh = await c.refresh(account);
    const updated = { ...account, ...fresh };
    await store.updateAccount(account.id, fresh);
    return updated;
  } catch (e) {
    throw new Error(`${account.name}: token refresh failed (${e.message}). Reconnect the account.`);
  }
}

export function connectorInfo() {
  return Object.entries(connectors).map(([id, c]) => ({
    id,
    label: c.label,
    configured: c.needs.every((k) => env(k)),
    missing: c.needs.filter((k) => !env(k)),
    redirectUri: redirectUri(id),
  }));
}

/** Insert or update an account, keyed by (platform, externalId). */
export async function saveAccount(a) {
  const existing = (await store.listAccounts()).find((x) => x.platform === a.platform && x.externalId === a.externalId);
  if (existing) {
    const { refreshToken, ...rest } = a;
    await store.updateAccount(existing.id, { ...rest, ...(refreshToken ? { refreshToken } : {}) });
    return existing.id;
  }
  const id = crypto.randomUUID();
  await store.putAccount({ id, createdAt: new Date().toISOString(), ...a });
  return id;
}

// ---- stateless CSRF protection: signed state + matching nonce cookie ----
export function startFlow(id) {
  const c = connectors[id];
  if (!c) return { error: 'Unknown connector' };
  if (!c.needs.every((k) => env(k))) return { error: `Set ${c.needs.join(' and ')} in the environment first` };
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = sign({ id, n: nonce, exp: Date.now() + 600_000 });
  return { url: c.authUrl(state), nonce };
}

export async function finishFlow(id, { code, state, error, errorDescription }, nonceCookie) {
  const c = connectors[id];
  const st = verify(state);
  if (!c || !st || st.id !== id || !nonceCookie || st.n !== nonceCookie)
    throw new Error('Login session expired, please try again');
  if (error) throw new Error(errorDescription || error);
  const accounts = await c.finish(code);
  for (const a of accounts) await saveAccount(a);
  return accounts.map((a) => a.name);
}
