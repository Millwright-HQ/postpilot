import * as store from '@/lib/store.js';
import { connectorInfo } from '@/lib/oauth.js';
import { publicAccount, fail } from '@/lib/service.js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const accounts = (await store.listAccounts()).map(publicAccount).sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ accounts, connectors: connectorInfo() });
  } catch (e) {
    return fail(e);
  }
}
