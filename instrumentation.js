// Local dev only: no EventBridge here, so poll for due posts every 15 seconds.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.STORE !== 'file') return;
  const { sweep } = await import('./lib/publisher.js');
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await sweep();
    } catch (e) {
      console.error('local poller error:', e.message);
    } finally {
      busy = false;
    }
  }, 15_000);
  console.log('[local] polling for due posts every 15s (STORE=file)');
}
