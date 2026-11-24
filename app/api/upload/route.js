import { createUpload, fail } from '@/lib/service.js';

// Step 1 of an upload: returns a presigned S3 URL; the browser PUTs the file straight to S3,
// so big videos never pass through Vercel's size/time limits.
export async function POST(request) {
  try {
    return Response.json(await createUpload(await request.json()));
  } catch (e) {
    return fail(e);
  }
}
