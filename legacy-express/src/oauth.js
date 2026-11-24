// OAuth "Connect account" flows for Meta (Facebook + Instagram), Google (YouTube) and TikTok.
// Each connector builds the consent URL, then turns the returned ?code into account rows.
import express from 'express';
import crypto from 'node:crypto';
import { upsertAccount, updateTokens } from './accounts.js';

const env = (k) => process.env[k] || '';
export const baseUrl = () => (env('PUBLIC_BASE_URL') || 'http://localhost:3000').replace(/\/$/, '');
const redirectUri = (id) => `${baseUrl()}/auth/${id}/callback`;
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
        out.push({ platform: 'facebook', external_id: p.id, name: p.name, access_token: p.access_token });
        const ig = p.instagram_business_account;
        if (ig)
          out.push({ platform: 'instagram', external_id: ig.id, name: `@${ig.username}`, access_token: p.access_token });
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
        external_id: channel.id,
        name: channel.snippet.title,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: inSeconds(tok.expires_in),
      }];
    },
    refresh: (acct) =>
      http('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: env('GOOGLE_CLIENT_ID'),
          client_secret: env('GOOGLE_CLIENT_SECRET'),
          refresh_token: acct.refresh_token,
          grant_type: 'refresh_token',
        }),
      }).then((t) => ({ access_token: t.access_token, expires_at: inSeconds(t.expires_in) })),
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
        external_id: tok.open_id,
        name,
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: inSeconds(tok.expires_in),
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
          refresh_token: acct.refresh_token,
        }),
      }).then((t) => ({
        access_token: t.access_token,
        refresh_token: t.refresh_token, // TikTok may rotate it
        expires_at: inSeconds(t.expires_in),
      })),
  },
};

const connectorFor = { facebook: 'meta', instagram: 'meta', youtube: 'google', tiktok: 'tiktok' };

/** Providers call this before using an account: refreshes expiring tokens and saves them. */
export async function ensureFresh(account) {
  const c = connectors[connectorFor[account.platform]];
  if (!c?.refresh || !account.expires_at) return account;
  if (new Date(account.expires_at).getTime() - Date.now() > 120_000) return account;
  if (!account.refresh_token) throw new Error(`${account.name}: session expired, reconnect the account`);
  try {
    return updateTokens(account.id, await c.refresh(account));
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

// CSRF protection: remember each state we hand out for 10 minutes
const states = new Map();
const newState = (id) => {
  const s = crypto.randomBytes(16).toString('hex');
  states.set(s, { id, exp: Date.now() + 600_000 });
  return s;
};

export const authRouter = express.Router();

authRouter.get('/:id/start', (req, res) => {
  const c = connectors[req.params.id];
  if (!c) return res.status(404).send('Unknown connector');
  if (!c.needs.every((k) => env(k))) return res.redirect(`/?error=${encodeURIComponent(`Set ${c.needs.join(' and ')} in .env first`)}`);
  res.redirect(c.authUrl(newState(req.params.id)));
});

authRouter.get('/:id/callback', async (req, res) => {
  const c = connectors[req.params.id];
  const back = (k, v) => res.redirect(`/?${k}=${encodeURIComponent(v)}`);
  try {
    const st = states.get(req.query.state);
    states.delete(req.query.state);
    if (!c || !st || st.id !== req.params.id || st.exp < Date.now()) throw new Error('Login session expired, please try again');
    if (req.query.error) throw new Error(req.query.error_description || req.query.error);
    const accounts = await c.finish(req.query.code);
    accounts.forEach(upsertAccount);
    back('connected', accounts.map((a) => a.name).join(', '));
  } catch (e) {
    console.error(`OAuth ${req.params.id} failed:`, e.message);
    back('error', e.message);
  }
});
