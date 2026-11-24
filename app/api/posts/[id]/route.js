import { reschedulePost, deletePost, fail } from '@/lib/service.js';

export async function PATCH(request, { params }) {
  try {
    const { scheduledAt } = await request.json();
    return Response.json(await reschedulePost((await params).id, scheduledAt));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req, { params }) {
  try {
    await deletePost((await params).id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return fail(e);
  }
}
