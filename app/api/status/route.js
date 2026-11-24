import { isDryRun } from '@/lib/env.js';

export const dynamic = 'force-dynamic';

export const GET = () => Response.json({ dryRun: isDryRun() });
