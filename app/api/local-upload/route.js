import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LOCAL } from '@/lib/env.js';
import { LOCAL_MEDIA_DIR } from '@/lib/service.js';

// Local dev stand-in for an S3 presigned PUT.
export async function PUT(request) {
  if (!LOCAL) return new Response('Not found', { status: 404 });
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!/^media\/[\w.-]+$/.test(key)) return new Response('Bad key', { status: 400 });
  fs.mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });
  await pipeline(Readable.fromWeb(request.body), fs.createWriteStream(path.join(LOCAL_MEDIA_DIR, path.basename(key))));
  return new Response(null, { status: 200 });
}
