import * as facebook from './facebook.js';
import * as instagram from './instagram.js';
import * as tiktok from './tiktok.js';
import * as youtube from './youtube.js';

// Add linkedin / threads / x here later: each provider exports
//   validate(post): string | null            (error message if the post can't go to this platform)
//   publish(post, account): Promise<{ id }>  (account row has tokens; see accounts.js)
// and gets a connector in oauth.js.
export const providers = { facebook, instagram, tiktok, youtube };

export const DRY_RUN = process.env.DRY_RUN !== 'false';

export async function publishTo(platform, post, account) {
  const p = providers[platform];
  if (!p) throw new Error(`Unknown platform: ${platform}`);
  if (DRY_RUN) {
    console.log(`[dry-run] would publish to ${platform} (${account?.name ?? 'no account'}):`, post.caption.slice(0, 60));
    return { id: `dry-run-${Date.now()}` };
  }
  if (!account) throw new Error('Account was disconnected');
  return p.publish(post, account);
}
