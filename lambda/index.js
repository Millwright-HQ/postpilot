// AWS Lambda entry point.
//   { targetId }  -> fired by a one-time EventBridge Scheduler schedule (or a direct invoke for "post now")
//   { sweep:true } -> fired hourly by EventBridge: publishes anything overdue (safety net)
import { loadSecrets } from '../lib/env.js';
import { publishTarget, sweep } from '../lib/publisher.js';

export async function handler(event) {
  await loadSecrets(); // OAuth client secrets for token refresh come from SSM
  if (event?.targetId) return { result: await publishTarget(event.targetId) };
  if (event?.sweep) return { result: await sweep() };
  console.warn('Unknown event', JSON.stringify(event));
  return { result: 'ignored' };
}
