import { listPostsView, createPost, fail } from '@/lib/service.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await listPostsView());
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request) {
  try {
    return Response.json(await createPost(await request.json()), { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
