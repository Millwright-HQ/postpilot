// YouTube Data API v3 resumable upload.
// NOTE: videos uploaded by unverified API projects are locked to private.
// The video is downloaded from its public media URL, then uploaded (buffered in memory).
import { ensureFresh } from '../oauth.js';

export const validate = (post) =>
  post.mediaType !== 'video' ? 'YouTube requires a video' : null;

export async function publish({ caption, mediaUrl }, account) {
  const { accessToken } = await ensureFresh(account);
  const title = (caption.split('\n')[0] || 'Untitled').slice(0, 100);

  const src = await fetch(mediaUrl);
  if (!src.ok) throw new Error(`Could not read media (${src.status})`);
  const bytes = Buffer.from(await src.arrayBuffer());
  const type = src.headers.get('content-type') || 'video/mp4';

  const init = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': type,
        'X-Upload-Content-Length': String(bytes.length),
      },
      body: JSON.stringify({
        snippet: { title, description: caption },
        status: { privacyStatus: process.env.YT_PRIVACY || 'private', selfDeclaredMadeForKids: false },
      }),
    }
  );
  if (!init.ok) throw new Error(`YouTube init failed: ${await init.text()}`);

  const up = await fetch(init.headers.get('location'), {
    method: 'PUT',
    headers: { 'Content-Type': type, 'Content-Length': String(bytes.length) },
    body: bytes,
  });
  const json = await up.json();
  if (!up.ok) throw new Error(json.error?.message || JSON.stringify(json));
  return { id: json.id };
}
