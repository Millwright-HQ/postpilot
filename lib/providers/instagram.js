// Instagram (business/creator account) via the Graph API.
// Two ways to connect: through a Facebook Page (graph.facebook.com) or directly with
// Instagram Login (graph.instagram.com, account.via === 'instagram').
// Flow: create media container -> wait until processed -> publish container.
// Media must be at a public URL (S3 in production).
import { ensureFresh } from '../oauth.js';

const host = (account) =>
  account.via === 'instagram' ? 'https://graph.instagram.com/v21.0' : 'https://graph.facebook.com/v21.0';

export const validate = (post) =>
  !post.mediaType ? 'Instagram requires an image or video' : null;

async function call(G, token, path, params, method = 'POST') {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${G}/${path}${method === 'GET' ? `?${qs}` : ''}`, {
    method,
    body: method === 'POST' ? qs : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || JSON.stringify(json));
  return json;
}

export async function publish({ caption, mediaUrl, mediaType }, account) {
  const G = host(account);
  const { accessToken: token } = await ensureFresh(account);
  const params =
    mediaType === 'video'
      ? { media_type: 'REELS', video_url: mediaUrl, caption }
      : { image_url: mediaUrl, caption };
  const { id: creationId } = await call(G, token, `${account.externalId}/media`, params);

  // videos are processed asynchronously
  for (let i = 0; i < 60; i++) {
    const { status_code } = await call(G, token, creationId, { fields: 'status_code' }, 'GET');
    if (status_code === 'FINISHED') break;
    if (status_code === 'ERROR' || status_code === 'EXPIRED')
      throw new Error(`Instagram processing failed (${status_code})`);
    await new Promise((r) => setTimeout(r, 4000));
  }
  const { id } = await call(G, token, `${account.externalId}/media_publish`, { creation_id: creationId });
  return { id };
}
