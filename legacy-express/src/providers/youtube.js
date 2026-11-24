// YouTube Data API v3 resumable upload.
// NOTE: videos uploaded by unverified API projects are locked to private.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureFresh } from '../oauth.js';

export const validate = (post) =>
  post.mediaType !== 'video' ? 'YouTube requires a video' : null;

export async function publish({ caption, filePath }, account) {
  const { access_token } = await ensureFresh(account);
  const title = (caption.split('\n')[0] || 'Untitled').slice(0, 100);
  const bytes = await fs.readFile(filePath);
  const type = path.extname(filePath).toLowerCase() === '.mov' ? 'video/quicktime' : 'video/mp4';

  const init = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
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
