import { retryPost, fail } from '@/lib/service.js';

export async function POST(_req, { params }) {
  try {
    return Response.json(await retryPost((await params).id));
  } catch (e) {
    return fail(e);
  }
}
