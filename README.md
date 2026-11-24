# PostPilot

Schedule posts to Instagram, Facebook, TikTok and YouTube.
Next.js on Vercel (UI + API) · DynamoDB · S3 · EventBridge Scheduler → Lambda publisher.

## Run locally (no AWS needed)
```bash
cp .env.example .env.local     # keep STORE=file and DRY_RUN=true, set ADMIN_PASSWORD
npm run dev                    # http://localhost:3000
```
Local mode stores data in `./data/store.json` and polls for due posts every 15s.
Use Accounts → "Add demo accounts" to try everything without developer apps.

## Deploy
1. `infra/README.md`: create the AWS stack, SSM secrets and the Vercel access key.
2. `npm run deploy:lambda` (builds `dist/lambda.zip`, uploads it to the publisher function).
3. Vercel: import this folder, add your domain, set the env vars listed under "production" in `.env.example`
   (remove `STORE`), and set `ADMIN_PASSWORD` and `AUTH_SECRET` (`openssl rand -base64 32`).
4. Register `https://yourdomain/auth/{meta,google,tiktok}/callback` in each developer app.
5. To go live: set `DRY_RUN=false` in Vercel and redeploy the stack with `DryRun=false` (the Lambda reads its own copy).

`legacy-express/` is the first local-only version, kept for reference.
