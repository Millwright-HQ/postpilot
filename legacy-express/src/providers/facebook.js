// Facebook Page publishing via Graph API (account = one Page, token = Page token).
// Media is sent by public URL (PUBLIC_BASE_URL must be reachable from the internet).
export const validate = (post) =>
  !post.caption && !post.mediaType ? 'Facebook needs text or media' : null;

export async function publish({ caption, mediaUrl, mediaType }, account) {
  let path = 'feed';
  const body = new URLSearchParams({ access_token: account.access_token });
  if (mediaType === 'image') {
    path = 'photos';
    body.set('url', mediaUrl);
    body.set('caption', caption);
  } else if (mediaType === 'video') {
    path = 'videos';
    body.set('file_url', mediaUrl);
    body.set('description', caption);
  } else {
    body.set('message', caption);
  }
  const res = await fetch(`https://graph.facebook.com/v21.0/${account.external_id}/${path}`, {
    method: 'POST',
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || JSON.stringify(json));
  return { id: json.post_id || json.id };
}
