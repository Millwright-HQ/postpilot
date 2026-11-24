import fs from 'node:fs';
import path from 'node:path';
import { LOCAL } from '@/lib/env.js';
import { LOCAL_MEDIA_DIR } from '@/lib/service.js';

const TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
};

// Local dev only: serves uploaded media. In production media is served from S3.
export async function GET(_req, { params }) {
  if (!LOCAL) return new Response('Not found', { status: 404 });
  const file = path.basename((await params).file);
  try {
    const data = await fs.promises.readFile(path.join(LOCAL_MEDIA_DIR, file));
    return new Response(data, { headers: { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
