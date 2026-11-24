import { isDryRun } from '@/lib/env.js';
import { providers } from '@/lib/providers/index.js';
import { saveAccount } from '@/lib/oauth.js';
import { fail } from '@/lib/service.js';

// dry-run only: fake accounts so you can try the UI without any developer apps
export async function POST() {
  if (!isDryRun()) return Response.json({ error: 'Demo accounts only exist in dry-run mode' }, { status: 400 });
  try {
    for (const platform of Object.keys(providers))
      await saveAccount({ platform, externalId: 'demo', name: `Demo ${platform}`, accessToken: 'demo' });
    return new Response(null, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
