# PostPilot AWS infrastructure

`template.yaml` creates: S3 media bucket, 3 DynamoDB tables, the publisher Lambda (placeholder code),
one-time EventBridge Scheduler schedules (one per post) plus an hourly safety-net sweep, an IAM user for Vercel, and a budget alert.

## Deploy
```bash
aws login            # or: aws configure
aws cloudformation deploy \
  --stack-name postpilot \
  --template-file infra/template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --parameter-overrides \
      AlertEmail=you@example.com \
      AppOrigins="https://postpilot.yourdomain.com,http://localhost:3000"

aws cloudformation describe-stacks --stack-name postpilot --query "Stacks[0].Outputs" --output table
```
Pick the region closest to you, and use the same one for every command.

## Secrets (SSM Parameter Store, free for standard parameters)
```bash
aws ssm put-parameter --name /postpilot/META_APP_SECRET --type SecureString --value '...'
aws ssm put-parameter --name /postpilot/GOOGLE_CLIENT_SECRET --type SecureString --value '...'
aws ssm put-parameter --name /postpilot/TIKTOK_CLIENT_SECRET --type SecureString --value '...'
```

## Credentials for Vercel
```bash
aws iam create-access-key --user-name postpilot-vercel
```
Put `AccessKeyId` / `SecretAccessKey` in Vercel env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_REGION`), plus the table and bucket names from the stack outputs.

## Deleting
Tables and the bucket have `DeletionPolicy: Retain`, so deleting the stack keeps your data.
Remove them by hand when you really want them gone.
