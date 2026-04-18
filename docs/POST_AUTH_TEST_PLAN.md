# Solo — Post-Auth Integration Test Plan

**Scope:** Verify the AWS Cognito + RDS + GitHub-OIDC-wrapper migration works end-to-end across the Solo desktop app and solo-web. · **Last updated:** 2026-04-16

## How to use this doc

Run sections in order. Each section has checkboxes — work top to bottom within a section. If something fails, there's a "When this fails" hint pointing to the most likely root cause. When you finish a section, you know that layer is good; move on.

---

## Section 0 — Prerequisites

These must be done before anything below works.

### 0.1 Apply Drizzle schema to RDS (once)

```bash
DB_PASSWORD=$(aws secretsmanager get-secret-value --profile solo \
  --secret-id solo/dev/rds-admin --query SecretString --output text | jq -r '.password')

PGPASSWORD="$DB_PASSWORD" psql \
  -h solo-db-dev.cgxcqy6sq3vr.us-east-1.rds.amazonaws.com \
  -U solo_admin -d solo -p 5432 \
  -f solo-web/lib/db/migrations/0000_sudden_ken_ellis.sql
```

- [ ] Command completes without error
- [ ] `\dt` inside psql lists all 6 tables: `waitlist`, `allowed_users`, `admin_users`, `download_logs`, `contact_submissions`, `job_applications`

**When this fails:** check `aws configure list-profiles` shows `solo`; ensure the security group allows your IP on 5432 (it should allow all IPv4 by design for dev).

### 0.2 Seed your own admin email

```bash
PGPASSWORD="$DB_PASSWORD" psql \
  -h solo-db-dev.cgxcqy6sq3vr.us-east-1.rds.amazonaws.com \
  -U solo_admin -d solo -p 5432 \
  -c "INSERT INTO admin_users (email) VALUES ('YOUR_EMAIL@example.com') ON CONFLICT DO NOTHING;
      INSERT INTO allowed_users (email, name, added_by) VALUES ('YOUR_EMAIL@example.com', 'Your Name', 'bootstrap') ON CONFLICT DO NOTHING;"
```

- [ ] Insert succeeds (both tables, or `ON CONFLICT DO NOTHING` absorbs dup inserts)

### 0.3 Backfill Supabase data (optional; only if you have prod data to preserve)

```bash
pg_dump --data-only \
  --table=public.waitlist \
  -h db.<supabase-ref>.supabase.co -U postgres -d postgres \
  > supabase-waitlist-backup.sql

PGPASSWORD="$DB_PASSWORD" psql \
  -h solo-db-dev.cgxcqy6sq3vr.us-east-1.rds.amazonaws.com \
  -U solo_admin -d solo -p 5432 < supabase-waitlist-backup.sql
```

- [ ] Row count in RDS matches Supabase: `SELECT count(*) FROM waitlist;`

### 0.4 Set up solo-web `.env.local`

```bash
cd solo-web
cp .env.example .env.local
# Edit .env.local: set NEXTAUTH_SECRET to `openssl rand -base64 32`
# Paste DATABASE_URL using the password from 0.1
```

- [ ] `.env.local` has every env var from `.env.example` populated with real values

### 0.5 Set up desktop auth env

Recommended:

```bash
cd solo
bun run auth:doctor
```

- [ ] `bun run auth:doctor` shows `SOLO_COGNITO_DOMAIN`, `SOLO_COGNITO_CLIENT_ID`, `SOLO_AWS_REGION`, and `SOLO_API_ENDPOINT`

---

## Section 1 — Infrastructure smoke tests

All checks are read-only; takes ~30 seconds.

### 1.1 CloudFormation stacks are `UPDATE_COMPLETE` / `CREATE_COMPLETE`

```bash
aws cloudformation describe-stacks --profile solo --region us-east-1 \
  --query 'Stacks[?starts_with(StackName, `Solo`)].{name:StackName,status:StackStatus}' \
  --output table
```

- [ ] `SoloAuth-dev`, `SoloGitHub-dev`, `SoloData-dev`, `SoloStorage-dev`, `SoloApi-dev`, `SoloRds-dev` — all `CREATE_COMPLETE` or `UPDATE_COMPLETE`

### 1.2 OIDC discovery is reachable

```bash
curl -s https://3b7g774mq7.execute-api.us-east-1.amazonaws.com/.well-known/openid-configuration | jq .
```

- [ ] Returns JSON with `issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`
- [ ] `jwks_uri` returns a key set: `curl -s <jwks_uri> | jq .keys[0].kty` prints `"RSA"`

### 1.3 API Gateway rejects unauthenticated requests

```bash
curl -i -s https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com/v1/tier/me | head -1
```

- [ ] Response is `HTTP/2 401` (Cognito authorizer is enforcing)

### 1.4 RDS is reachable

```bash
PGPASSWORD="$DB_PASSWORD" psql \
  -h solo-db-dev.cgxcqy6sq3vr.us-east-1.rds.amazonaws.com \
  -U solo_admin -d solo -p 5432 -c "SELECT version();"
```

- [ ] Returns a PostgreSQL 16 version string

---

## Section 2 — Auth flows (desktop app)

Assumes Section 0.5 passes. Start the app with:

```bash
cd solo
bun run dev:auth
```

### 2.1 Google sign-in (desktop)

- [ ] Login screen shows GitHub, Google, and Email buttons
- [ ] Click "Continue with Google" → browser opens
- [ ] URL contains `identity_provider=Google` and `code_challenge=...`
- [ ] Sign in with your Google account
- [ ] Browser redirects to `soloide://auth/callback?code=...`
- [ ] Desktop app accepts the code and lands on authenticated state
- [ ] Your email shows somewhere in the app (settings or titlebar)

**When this fails:** the most likely culprit is the `solo/dev/google-oidc-client` secret missing real client ID/secret (see earlier plan for populating via AWS Console).

### 2.2 GitHub sign-in (desktop)

- [ ] Click "Continue with GitHub"
- [ ] Browser URL chain: wrapper `/authorize` → github.com/login/oauth → wrapper `/callback` → Cognito `/oauth2/idpresponse` → back to `soloide://auth/callback`
- [ ] After completion, check RDS: the Cognito User Pool should have a new user row with `identities` including the GitHub provider
- [ ] Check DynamoDB `solo-github-tokens-dev`: the user's row should contain an `access_token` (value captured by post-auth Lambda trigger)

```bash
aws dynamodb scan --profile solo --region us-east-1 \
  --table-name solo-github-tokens-dev --max-items 5 \
  --query 'Items[].{userId:userId.S,login:github_login.S,scopes:granted_scopes.S}' \
  --output table
```

- [ ] Your GitHub login appears with `repo` in granted_scopes

**When this fails:** check CloudWatch logs `/aws/lambda/solo-gh-oidcWrapper-dev` and `/aws/lambda/solo-gh-postAuth-dev`.

### 2.3 Email sign-in (desktop)

- [ ] Type an email into the Email field, click "Continue with Email"
- [ ] Browser opens Cognito Hosted UI with your email pre-filled via `login_hint`
- [ ] Create password / verify email / sign in
- [ ] Lands back on desktop authenticated

### 2.4 Sign out (desktop)

- [ ] Click sign out (wherever it lives in the UI)
- [ ] Browser briefly opens to Cognito `/logout`
- [ ] Desktop returns to login screen
- [ ] Vault entries gone: `security find-generic-password -s com.solo-ide.credentials` still exists as a keychain entry but the JSON inside no longer contains `cognito.accessToken`

### 2.5 Session persistence across desktop restart

- [ ] Sign in via any provider
- [ ] Fully quit the app (⌘Q, not just close window)
- [ ] Relaunch — should land authenticated without re-signing-in
- [ ] Check that the user ID matches what it was before

---

## Section 3 — Auth flows (solo-web)

Start: `cd solo-web && bun dev`. Visit `http://localhost:3000`.

### 3.1 Public pages don't require auth

- [ ] `/` loads without redirect
- [ ] `/blog` loads without redirect
- [ ] `/features`, `/pricing`, `/careers` all load without redirect
- [ ] `/signin`, `/signup` load without redirect (obviously)

### 3.2 Protected routes redirect

- [ ] Visit `/beta` while signed out → redirected to `/signin?callbackUrl=%2Fbeta`
- [ ] Visit `/admin` while signed out → redirected to `/signin?callbackUrl=%2Fadmin`

### 3.3 Sign in via Google (web)

- [ ] From `/signin`, click "Continue to sign in"
- [ ] Redirected to Cognito Hosted UI
- [ ] Choose Google → sign in with same account used in 2.1
- [ ] Lands back on `callbackUrl` (`/beta` or `/` if none)
- [ ] `http://localhost:3000/api/auth/session` returns JSON with `user.email`, `user.id`, `user.isAllowed`, `user.isAdmin`

### 3.4 Shared identity verification (critical)

This verifies both apps see the same user.

- [ ] Sign into desktop with your Google account (from 2.1)
- [ ] Sign into solo-web with the **same** Google account (from 3.3)
- [ ] In psql: `SELECT * FROM admin_users;` — your email should match the one stored in 0.2
- [ ] `session.user.isAdmin` should be `true` on solo-web (your email was seeded as admin)
- [ ] Desktop's Cognito `sub` should match solo-web's `session.user.id` — they come from the same pool

### 3.5 Role gating

- [ ] `/admin` loads (you're admin per 0.2)
- [ ] `/admin/users` shows the `admin_users` and `allowed_users` tables from RDS
- [ ] `/beta` loads and offers the download link (you're allowed per 0.2)

**When this fails:** check `session.user.isAllowed` / `isAdmin`; if false, your email isn't in the right RDS table. Sign out + sign in again since roles are computed once at sign-in.

### 3.6 Sign out (web)

- [ ] Click sign-out on solo-web
- [ ] Session cookie cleared
- [ ] Visit `/beta` → redirected to `/signin` again

---

## Section 4 — Database CRUD via the app

### 4.1 Waitlist form (public, unauthenticated)

- [ ] From the homepage or `/join-waitlist`, submit a name + email
- [ ] Returns success to the user
- [ ] psql: `SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 5;` — new row
- [ ] Submit the same email again — expect conflict / dedupe behavior (emailUq uniqueIndex)

### 4.2 Contact form

- [ ] Submit the contact form with a test message
- [ ] psql: `SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT 5;` — new row

### 4.3 Job application form

- [ ] Submit the careers form
- [ ] psql: `SELECT * FROM job_applications ORDER BY created_at DESC LIMIT 5;` — new row

### 4.4 Download logging (admin/allowed users)

- [ ] From `/beta`, click download
- [ ] psql: `SELECT * FROM download_logs ORDER BY downloaded_at DESC LIMIT 5;` — new row with your email

### 4.5 Admin test-db endpoint

- [ ] While signed in as admin: `curl -b "next-auth.session-token=..." http://localhost:3000/api/test-db`
- [ ] Returns row counts across all 6 tables

Easier: just visit the URL while authenticated in the browser.

---

## Section 5 — GitHub access token flow

### 5.1 Direct retrieval via API

Grab a session token first (from `/api/auth/session` in the browser), then:

```bash
COGNITO_JWT="eyJ...your-id-token..."
curl -s https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com/v1/github/token \
  -H "Authorization: Bearer $COGNITO_JWT" | jq .
```

- [ ] Response contains `access_token`, `github_login`, `granted_scopes` — NOT a 404
- [ ] The `access_token` works against `api.github.com/user`:
  ```bash
  curl -s -H "Authorization: Bearer <that access_token>" https://api.github.com/user | jq .login
  ```
  → prints your GitHub username

**When this fails:** `404 not_linked` means the post-auth trigger didn't run (or you signed in via Google/Email, not GitHub). Either sign in again with GitHub, or use the link flow in 5.2.

### 5.2 Link flow (for Google/Email signed-in users)

If you signed in with Google but want GitHub for git ops:

```bash
curl -s -X POST https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com/v1/github/link \
  -H "Authorization: Bearer $COGNITO_JWT" | jq .authorizeUrl
```

- [ ] Returns an `authorizeUrl`
- [ ] Open that URL in browser → authenticate to GitHub → browser redirects to `soloide://github/linked?success=1`
- [ ] `GET /v1/github/token` now returns 200 with the newly-linked token

### 5.3 Unlink

```bash
curl -s -X DELETE https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com/v1/github/link \
  -H "Authorization: Bearer $COGNITO_JWT" | jq .
```

- [ ] Returns `{"unlinked": true}`
- [ ] Subsequent `GET /v1/github/token` returns 404

---

## Section 6 — Cross-app integration sanity

### 6.1 Same Cognito `sub`, same user everywhere

- [ ] Run `SELECT users.sub FROM ...` — actually Cognito doesn't expose users to RDS directly; use `aws cognito-idp list-users`:

```bash
aws cognito-idp list-users --profile solo --region us-east-1 \
  --user-pool-id us-east-1_S9C2mSy8E \
  --query 'Users[].{username:Username,email:Attributes[?Name==`email`].Value|[0],sub:Attributes[?Name==`sub`].Value|[0]}' \
  --output table
```

- [ ] Your email appears as a single user (not duplicated across providers)

### 6.2 Session JWT is the same token both apps understand

- [ ] Desktop: `auth_get_access_token` returns a JWT
- [ ] Copy that JWT, use it against the API Gateway endpoint:
  ```bash
  curl -s -H "Authorization: Bearer <desktop-jwt>" \
    https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com/v1/tier/me | jq .
  ```
- [ ] Returns the same data as the solo-web call would (since it's the same user)

### 6.3 solo-web's session JWT works against the same Lambda

Same idea in reverse — `session.accessToken` from NextAuth should be usable against the API Gateway.

---

## Section 7 — Failure modes (intentional negative tests)

Confirm the system fails safely.

### 7.1 Expired / bogus JWT is rejected

```bash
curl -i -s -H "Authorization: Bearer totally.fake.jwt" \
  https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com/v1/tier/me | head -1
```

- [ ] Returns `401`

### 7.2 Tampered OIDC token fails signature check

- [ ] (Optional, if you want to be paranoid) Modify the `id_token` Cognito returned, flip a bit in the payload, retry the endpoint → `401`

### 7.3 RDS rejects non-SSL connections

```bash
PGPASSWORD="$DB_PASSWORD" psql \
  -h solo-db-dev.cgxcqy6sq3vr.us-east-1.rds.amazonaws.com \
  -U solo_admin -d solo -p 5432 "sslmode=disable"
```

- [ ] Connection refused / "no SSL"

### 7.4 Public users can't call admin endpoints

While signed OUT:
- [ ] `GET /api/admin/users` → 401 or redirect to `/signin`
- [ ] `GET /api/test-db` → 401

While signed in as a NON-admin user:
- [ ] `GET /admin` → redirected to `/signin` or 403 page
- [ ] `GET /api/admin/users` → 403

### 7.5 Public users CAN submit waitlist/contact/apply

- [ ] POST `/api/waitlist` with no auth → 200 (inserts the row)
- [ ] POST `/api/contact` with no auth → 200
- [ ] POST `/api/apply` with no auth → 200

### 7.6 GitHub token is scoped per user

- [ ] While signed in as User A, call `GET /v1/github/token` → returns A's token
- [ ] While signed in as User B, call `GET /v1/github/token` → returns B's token (different access_token)
- [ ] There's no way to query for another user's token — the Lambda derives userId from JWT `sub`, not from request params

---

## Section 8 — Operational checks

### 8.1 CloudWatch logs are flowing

```bash
aws logs tail /aws/lambda/solo-syncStats-dev --profile solo --region us-east-1 --since 1h
aws logs tail /aws/lambda/solo-gh-oidcWrapper-dev --profile solo --region us-east-1 --since 1h
aws logs tail /aws/lambda/solo-gh-postAuth-dev --profile solo --region us-east-1 --since 1h
```

- [ ] Recent invocations visible (after doing 2.x and 3.x above, logs should have entries)

### 8.2 Costs are sensible

Visit the AWS Billing dashboard (or run `aws ce get-cost-and-usage`). After an hour of testing:

- [ ] Cognito charge: ~$0.00 (MAU-based; one user is free)
- [ ] Lambda: ~$0.00 (free tier 1M invocations/month)
- [ ] DynamoDB: ~$0.00 (pay-per-request, tiny usage)
- [ ] API Gateway: ~$0.00 (free tier 1M calls)
- [ ] RDS: incurring (~$0.43/day after free tier; $0 during free tier first 12 months)
- [ ] S3: ~$0.00

### 8.3 Dev DynamoDB tables stayed empty of stale data

```bash
aws dynamodb scan --profile solo --region us-east-1 --table-name solo-user-stats-dev --max-items 5
aws dynamodb scan --profile solo --region us-east-1 --table-name solo-daily-activity-dev --max-items 5
```

- [ ] Empty or only contains your user (no other test data bled in)

---

## Green-light criteria

The migration is considered **validated for dev** when:

1. ✅ Every item in Sections 0, 1, 2, 3, 4, 5, 7 is checked
2. ✅ No CloudWatch errors in the `/aws/lambda/solo-*` log groups in the last hour
3. ✅ A fresh browser, no cookies, can visit the homepage, sign up via waitlist, sign in via GitHub, and reach `/beta`

**Out of scope for this test plan** (tracked elsewhere):

- Phase 2 (tier / gamification) — not implemented yet
- Phase 3 (worktree UX redesign) — not implemented yet
- Production environment — separate deployment + OAuth apps needed
- Load testing / concurrency — dev instance is `db.t4g.micro`, not sized for load
- Disaster recovery (snapshot restore, stack teardown/rebuild) — validate before prod launch

---

## Troubleshooting quick-reference

| Symptom | First check |
|---|---|
| Desktop login button does nothing | Env vars not set (Section 0.5) |
| Desktop opens browser but login loops | Cognito client secret out of date (check `solo/dev/google-oidc-client`) |
| solo-web shows "internal server error" on sign-in | `NEXTAUTH_SECRET` not set in `.env.local` |
| solo-web redirects forever on `/beta` | Middleware running, auth() returning no session — check cookie set correctly (`next-auth.session-token`) |
| psql connection hangs | RDS security group doesn't allow your IP (it should by default `0.0.0.0/0`) |
| `GET /v1/github/token` returns 404 for a GitHub-signed-in user | Post-auth Lambda didn't fire; check `/aws/lambda/solo-gh-postAuth-dev` logs and `solo-github-pending-dev` TTL (it's 10 min) |
| Admin routes say "not authorized" | Your email isn't in `admin_users`; re-run Section 0.2 and sign out + sign in again |
| JWT signature verification fails on wrapper-minted tokens | JWKs endpoint returning stale key; Cognito caches for ~1h — wait or recreate the IdP |
