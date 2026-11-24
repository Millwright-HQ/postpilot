import { disconnectAccount, fail } from '@/lib/service.js';

export async function DELETE(_req, { params }) {
  try {
    await disconnectAccount((await params).id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return fail(e);
  }
}
