// Instagram (business/creator account linked to a Facebook Page) via Graph API.
// Flow: create media container -> wait until processed -> publish container.
// Media MUST be at a public URL (PUBLIC_BASE_URL, e.g. an ngrok/cloudflared tunnel).
const G = 'https://graph.facebook.com/v21.0';

export const validate = (post) =>
  !post.mediaType ? 'Instagram requires an image or video' : null;

async function call(token, path, params, method = 'POST') {
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
  const token = account.access_token;
  const params =
    mediaType === 'video'
      ? { media_type: 'REELS', video_url: mediaUrl, caption }
      : { image_url: mediaUrl, caption };
  const { id: creationId } = await call(token, `${account.external_id}/media`, params);

  // videos are processed asynchronously
  for (let i = 0; i < 30; i++) {
    const { status_code } = await call(token, creationId, { fields: 'status_code' }, 'GET');
    if (status_code === 'FINISHED') break;
    if (status_code === 'ERROR' || status_code === 'EXPIRED')
      throw new Error(`Instagram processing failed (${status_code})`);
    await new Promise((r) => setTimeout(r, 4000));
  }
  const { id } = await call(token, `${account.external_id}/media_publish`, { creation_id: creationId });
  return { id };
}
