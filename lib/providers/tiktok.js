// TikTok Content Posting API (Direct Post, PULL_FROM_URL).
// NOTE: until TikTok audits your app, posts can only be PRIVATE (SELF_ONLY), and
// PULL_FROM_URL requires your media domain to be verified in the TikTok developer portal.
import { ensureFresh } from '../oauth.js';

export const validate = (post) =>
  post.mediaType !== 'video' ? 'TikTok requires a video' : null;

export async function publish({ caption, mediaUrl }, account) {
  const { accessToken } = await ensureFresh(account);
  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 2200),
        privacy_level: process.env.TIKTOK_PRIVACY || 'SELF_ONLY',
      },
      source_info: { source: 'PULL_FROM_URL', video_url: mediaUrl },
    }),
  });
  const json = await res.json();
  if (!res.ok || (json.error?.code && json.error.code !== 'ok'))
    throw new Error(json.error?.message || JSON.stringify(json));
  return { id: json.data.publish_id };
}
