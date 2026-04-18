# Solo Infra

AWS CDK v2 (TypeScript) for Solo IDE's cloud backend: Cognito auth, stats sync, leaderboard, share cards.

## Stacks (deployed per stage)

| Stack | Contents |
|---|---|
| `SoloAuth-{stage}` | Cognito User Pool + Identity Pool + IdP secrets |
| `SoloData-{stage}` | DynamoDB: user-stats, daily-activity, share-cards |
| `SoloStorage-{stage}` | S3 bucket for share card PNGs (7-day TTL) |
| `SoloApi-{stage}` | HTTP API Gateway + 6 Lambdas |

Stages: `dev`, `prod`. Configured in `lib/config.ts`.

## Quick start

```bash
# From the solo/ workspace root (uses bun workspaces)
bun install

cd infra
bun run bootstrap:dev      # one-time per AWS account+region
bun run synth:dev          # inspect generated CloudFormation
bun run deploy:dev         # apply
```

See `SETUP.md` for the full browser walkthrough (GitHub + Google OAuth apps).

## Layout

```
infra/
├── bin/solo.ts           # CDK app entry
├── lib/
│   ├── config.ts         # Stage configuration (dev/prod)
│   ├── auth-stack.ts     # Cognito + IdP + IAM
│   ├── data-stack.ts     # DynamoDB tables + IAM
│   ├── storage-stack.ts  # S3 + lifecycle
│   └── api-stack.ts      # HTTP API + Lambdas
├── lambda/
│   ├── shared/           # Auth helpers, tier math, DDB client
│   ├── syncStats/
│   ├── getMyStats/
│   ├── getMyTier/
│   ├── getLeaderboard/
│   ├── getTierBoard/
│   └── generateCard/
├── cdk.json
├── tsconfig.json
└── SETUP.md              # One-time OAuth setup checklist
```

## GitHub federation

Cognito still cannot federate directly to GitHub because GitHub is not OIDC-compliant. Solo ships a small Lambda-backed OIDC wrapper in `lib/github-stack.ts` / `lambda/github/*` so Cognito can treat GitHub as a standards-compatible IdP.

Both `dev` and `prod` stages now support:

- Google federation via Cognito's native Google IdP
- GitHub federation via the Solo OIDC wrapper
- Email/password through the Cognito Hosted UI

## Common operations

```bash
bun run diff:dev           # show what deploy would change
bun run diff:prod          # prod diff (requires prod secrets / vars)
bun run synth:dev          # render CloudFormation YAML to cdk.out/
bun run synth:prod         # render prod CloudFormation
bun run destroy:dev        # tear down dev stage (retains prod)
```

## Secrets

After first deploy, populate OAuth client credentials:

```bash
aws secretsmanager put-secret-value --profile solo \
  --secret-id solo/dev/google-oidc-client \
  --secret-string '{"clientId":"...","clientSecret":"..."}'
```

Do the same for:

- `solo/dev/github-oidc-client`
- `solo/prod/google-oidc-client`
- `solo/prod/github-oidc-client`

Then redeploy the target stage so Cognito picks up the updated provider credentials:

```bash
bun run deploy:dev
# or
bun run deploy:prod
```
