// Runtime config shared by the Next.js app and the Lambda publisher.
export const LOCAL = process.env.STORE === 'file'; // local dev: JSON file store + polling scheduler

export function awsConfig() {
  const cfg = { region: process.env.APP_AWS_REGION || process.env.AWS_REGION || 'us-east-1' };
  // Vercel: explicit keys (APP_ prefix avoids clashes with reserved AWS_* names). Lambda: role credentials.
  if (process.env.APP_AWS_ACCESS_KEY_ID)
    cfg.credentials = {
      accessKeyId: process.env.APP_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.APP_AWS_SECRET_ACCESS_KEY,
    };
  return cfg;
}

export const mediaBaseUrl = () =>
  (process.env.MEDIA_BASE_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const publicBaseUrl = () => (process.env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const isDryRun = () => process.env.DRY_RUN !== 'false';

// Lambda only: pull OAuth client IDs/secrets from SSM Parameter Store (/<app>/NAME) into process.env.
let secrets;
export function loadSecrets() {
  if (LOCAL) return Promise.resolve();
  return (secrets ??= (async () => {
    const { SSMClient, GetParametersByPathCommand } = await import('@aws-sdk/client-ssm');
    const ssm = new SSMClient(awsConfig());
    let token;
    do {
      const r = await ssm.send(
        new GetParametersByPathCommand({ Path: `/${process.env.APP_NAME || 'postpilot'}`, WithDecryption: true, NextToken: token })
      );
      for (const p of r.Parameters ?? []) {
        const name = p.Name.split('/').pop();
        if (!process.env[name]) process.env[name] = p.Value;
      }
      token = r.NextToken;
    } while (token);
  })());
}
