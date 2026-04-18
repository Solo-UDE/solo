# GitHub Authentication — Handoff Document

**Status:** Incomplete — active bug in the web GitHub sign-in flow · **Last updated:** 2026-04-16

This document is a standalone briefing for someone picking up the GitHub authentication work. It covers the **desktop app** (Tauri) and the **web app** (solo-web / Next.js) flows, every AWS resource they depend on, how to launch both locally, and the exact state of the current bug.

---

## 1. TL;DR

- Solo has two sign-in surfaces: a Tauri desktop app and a Next.js marketing + beta site.
- Both federate through one **AWS Cognito User Pool** (`us-east-1_S9C2mSy8E`).
- Cognito speaks OIDC. Google works natively. **GitHub does not speak OIDC**, so we built a small Lambda-backed "OIDC wrapper" that makes GitHub look like an OIDC provider to Cognito.
- Google sign-in works on web **and** desktop.
- **GitHub sign-in on the web is currently broken** — flow exits at Cognito with `error=OAuthCallbackError` after one last 500. Root cause and suggested fix in §9.

---

## 2. AWS services used

| Service | Purpose | Identifier |
|---|---|---|
| **Cognito User Pool** | Canonical user identity store | `us-east-1_S9C2mSy8E` (`solo-users-dev`) |
| Cognito Hosted UI | Sign-in pages (Cognito-branded) | `solo-ide-dev.auth.us-east-1.amazoncognito.com` |
| Cognito App Client | The thing Solo-web / desktop authenticate AS | `3lvjbkkev35ejmm927rkfn13d3` — **public client, no secret, PKCE only** |
| Cognito Identity Provider — `Google` | Native OIDC to Google | client_id/secret in `solo/dev/google-oidc-client` |
| Cognito Identity Provider — `GitHub` | OIDC wrapper Lambda (see below) | `oidc_issuer=https://3b7g774mq7.execute-api.us-east-1.amazonaws.com`, `client_id=solo-desktop`, `client_secret=unused` |
| **API Gateway (OIDC wrapper)** | Exposes `/authorize`, `/callback`, `/token`, `/userinfo`, `/.well-known/{openid-configuration,jwks.json}` | `https://3b7g774mq7.execute-api.us-east-1.amazonaws.com` |
| **API Gateway (Solo app API)** | `/v1/*` Cognito-authorized routes (tier, leaderboard, github link/token/unlink) | `https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com` |
| **Lambda × 11** | See §3 for the list | — |
| **DynamoDB** — `solo-github-tokens-dev` | Per-user GitHub access tokens after link/sign-in | PK `userId` |
| **DynamoDB** — `solo-github-pending-dev` | Short-TTL pending tokens between wrapper mint and post-auth trigger | PK `github_user_id`, TTL 10 min |
| **DynamoDB** — `solo-user-stats-dev`, `solo-daily-activity-dev`, `solo-share-cards-dev` | Gamification (Phase 2, not part of auth) | — |
| **Secrets Manager** | OAuth app credentials + signing keys | see §3 |
| **KMS** — 2 keys | (a) Encrypts GitHub tokens in DynamoDB · (b) Signs id_tokens minted by the OIDC wrapper | — |
| **RDS** — `solo-db-dev` (Postgres 16) | solo-web application DB (waitlist, admin users, download logs, etc.) | `solo-db-dev.cgxcqy6sq3vr.us-east-1.rds.amazonaws.com` |
| **CloudFront + S3** | Not relevant to auth. | — |

### CloudFormation stacks

`SoloAuth-dev`, `SoloGitHub-dev`, `SoloData-dev`, `SoloStorage-dev`, `SoloApi-dev`, `SoloRds-dev` — all `CREATE_COMPLETE`/`UPDATE_COMPLETE`.

---

## 3. Lambda + Secret inventory

**GitHub OIDC wrapper** (`SoloGitHub-dev` stack, source in `solo/infra/lambda/github/`):

| Lambda | Entry | Purpose |
|---|---|---|
| `solo-gh-oidcWrapper-dev` | `oidcHandler.ts` | All 6 OIDC endpoints on the wrapper API Gateway |
| `solo-gh-linkStart-dev` | `linkStart.ts` | POST `/v1/github/link` — begins "add GitHub to existing account" flow |
| `solo-gh-getToken-dev` | `getToken.ts` | GET `/v1/github/token` — returns the caller's stored GitHub access token |
| `solo-gh-unlink-dev` | `unlink.ts` | DELETE `/v1/github/link` — removes linked GitHub |
| `solo-gh-postAuth-dev` | `postAuth.ts` | Cognito post-authentication trigger — fires when a user signs in via GitHub; moves row from `pending` to `tokens` table |

**Other Lambdas** (irrelevant to auth flow): `solo-syncStats-dev`, `solo-getMyStats-dev`, `solo-getMyTier-dev`, `solo-generateCard-dev`, `solo-getLeaderboard-dev`, `solo-getTierBoard-dev`.

**Secrets Manager**:

| Secret name | Full ARN | Contents |
|---|---|---|
| `solo/dev/github-oidc-client` | `arn:aws:secretsmanager:us-east-1:465443875827:secret:solo/dev/github-oidc-client-41tbB1` | `{clientId, clientSecret}` for **our GitHub OAuth App** (the one solo-gh-oidcWrapper uses to talk to GitHub) |
| `solo/dev/google-oidc-client` | `…google-oidc-client-TtF3NU` | `{clientId, clientSecret}` for Cognito's direct Google federation |
| `solo/dev/github-state-signing` | `…github-state-signing-m4dK7n` | HMAC secret for CSRF-protecting OAuth state tokens |
| `solo/dev/rds-admin` | `…rds-admin-rQlnbN` | `{username, password}` for RDS master user |

### GitHub OAuth App

Set up at `https://github.com/settings/developers`. Its `client_id` is what the wrapper uses to **talk to GitHub** (distinct from the OIDC `client_id` Cognito uses to identify itself to the wrapper — that's `solo-desktop`).

- **Homepage URL**: `https://solo.dev`
- **Authorization callback URL**: `https://3b7g774mq7.execute-api.us-east-1.amazonaws.com/callback`
- **Required scopes**: `read:user user:email repo workflow`

The `clientId`/`clientSecret` live in `solo/dev/github-oidc-client` Secrets Manager.

---

## 4. Environment layout

### Desktop (`solo/` repo)

| File | Purpose |
|---|---|
| `solo/infra/.env.dev` | Local desktop auth/runtime env for Cognito dev. Gitignored; loaded automatically by `bun run dev:auth` and by Rust debug builds when present. |
| `solo/.env.local` or `solo/.env` | Optional local overrides for desktop auth/runtime env. |
| `solo/.env` | May also hold unrelated local keys such as provider credentials. |

Required env vars the desktop reads at runtime (from the shared desktop auth config resolver):

- `SOLO_COGNITO_DOMAIN=solo-ide-dev.auth.us-east-1.amazoncognito.com`
- `SOLO_COGNITO_CLIENT_ID=3lvjbkkev35ejmm927rkfn13d3`
- `SOLO_AWS_REGION=us-east-1` (or `AWS_REGION`)
- `SOLO_API_ENDPOINT=https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com`

Run `bun run auth:doctor` to see the effective values and where they came from before launching the desktop app.

### Web (`solo-web/` repo)

Template: `solo-web/.env.example`. Copy to `.env.local`, fill in:

```bash
COGNITO_DOMAIN=solo-ide-dev.auth.us-east-1.amazoncognito.com
COGNITO_USER_POOL_ID=us-east-1_S9C2mSy8E
COGNITO_CLIENT_ID=3lvjbkkev35ejmm927rkfn13d3
COGNITO_REGION=us-east-1

NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000      # must match the port you actually run on

DATABASE_URL="postgresql://solo_admin:<URL-ENCODED-PASSWORD>@solo-db-dev.cgxcqy6sq3vr.us-east-1.rds.amazonaws.com:5432/solo?sslmode=require&uselibpqcompat=true"

SOLO_API_ENDPOINT=https://vd8wm2yqle.execute-api.us-east-1.amazonaws.com
```

Fetch the RDS password:

```bash
aws --profile solo secretsmanager get-secret-value \
  --secret-id solo/dev/rds-admin --query SecretString --output text | jq -r '.password'
```

URL-encode special characters (`^`, `=`, `@`, `:`, `/`, `#`) before inserting into `DATABASE_URL`. `uselibpqcompat=true` is required because newer `pg` driver treats `sslmode=require` as `verify-full`; this flag restores the old semantics.

---

## 5. How to launch — **the website** (`solo-web`)

```bash
cd /Users/sachin/Developer/Orbit_Main/solo-web

# 1. Ensure dependencies are installed
bun install

# 2. Copy + fill env
cp .env.example .env.local
# edit .env.local — see §4 for values

# 3. Start
bun dev
```

Expected output: `Ready on http://localhost:3000`. If port 3000 is taken Next will pick 3001; in that case either free :3000 (`lsof -iTCP:3000 -sTCP:LISTEN`) or update `NEXTAUTH_URL` to match.

**Smoke check:**

```bash
curl -s -o /dev/null -w 'GET / %{http_code}\n' http://localhost:3000/
# → GET / 200
curl -s -D - http://localhost:3000/beta | head -3
# → 307 Temporary Redirect, location: http://localhost:3000/signin?callbackUrl=%2Fbeta
```

### Sign-in paths on the website

- Header button **"Sign in"** (or direct to `/signin`) → NextAuth `signIn('cognito')` → Cognito Hosted UI → Google/GitHub/Email → callback to `/api/auth/callback/cognito` → session cookie set.
- Gated routes: `/beta`, `/admin`, `/account`, `/dashboard` (see `middleware.ts`).

---

## 6. How to launch — **the desktop app** (`solo/apps/desktop`)

```bash
cd /Users/sachin/Developer/Orbit_Main/solo

# Show the effective desktop auth env
bun run auth:doctor

# Launch with the auth guard mounted and the dev Cognito env loaded
bun run dev:auth
```

### Why `bun run dev:auth`

`apps/desktop/src/components/auth/AuthGuard.tsx` bypasses auth in dev by default (so unrelated feature work doesn't need sign-in). Set `VITE_AUTH_ENABLED=1` to mount the real guard and see `LoginScreen`.

`bun run dev:auth` does that for you and also loads the local Cognito env contract.

On macOS, end-to-end OAuth callback testing is more reliable with:

```bash
bun run dev:auth:mac
```

That command builds a local debug `Solo.app`, installs it into `/Applications`,
refreshes Launch Services for `soloide://`, and preserves any existing
installed app as `/Applications/Solo (Production Backup).app`.

### Sign-in paths on the desktop

1. **Continue with GitHub** / **Continue with Google** → opens browser → Cognito Hosted UI.
2. **Email** → opens browser with Cognito Hosted UI, email pre-filled via `login_hint`.

Tauri deep-link callback: `soloide://auth/callback?code=...` → `auth_exchange_code` Rust command → tokens stored in OS keychain → UI unlocks.

---

## 7. The two auth flows end-to-end

### Google (works on both surfaces)

```
[Solo-web or Desktop] —signIn('cognito')→ Cognito Hosted UI
Cognito —federated OIDC→ Google
Google —id_token→ Cognito
Cognito —app session code→ [Solo-web callback / soloide://auth/callback]
[Client] —token exchange→ Cognito —access/id_token→ [Client]
```

No wrapper Lambda involved. Google credentials at `solo/dev/google-oidc-client`.

### GitHub (uses OIDC wrapper because GitHub doesn't speak OIDC)

```
[Solo-web or Desktop] —signIn('cognito')→ Cognito Hosted UI
User picks GitHub
Cognito —OIDC /authorize→ https://3b7g774mq7…/authorize
                              ?client_id=solo-desktop   ← Cognito's registered id
                              &redirect_uri=https://…cognito.com/oauth2/idpresponse
                              &state=<Cognito's state>
wrapper Lambda builds our own state, stashes Cognito's state inside,
                              redirects to github.com/login/oauth/authorize
User authorizes on GitHub
GitHub —code→ https://3b7g774mq7…/callback?code=...&state=...
wrapper extracts Cognito's state + redirect_uri,
                              redirects to Cognito's idpresponse URL with the GitHub code
Cognito —OIDC /token→ https://3b7g774mq7…/token
  POST  grant_type=authorization_code
        code=<github code>
        redirect_uri=<…idpresponse>
        client_id=solo-desktop              ← Cognito identifies itself
        client_secret=unused
wrapper exchanges the GitHub code for a GitHub access token,
wrapper fetches the GitHub user + email,
wrapper mints an RS256-signed id_token:
    iss: https://3b7g774mq7.execute-api.us-east-1.amazonaws.com
    sub: github:<github numeric id>
    aud: solo-desktop                       ← MUST match the client_id Cognito sent
    email, email_verified, name, preferred_username, picture
wrapper writes (github_user_id, access_token) → solo-github-pending-dev (TTL 10m)
Cognito accepts the id_token, creates/updates user in pool
Cognito post-authentication trigger (solo-gh-postAuth-dev) fires:
  reads the pending row, moves it to solo-github-tokens-dev (keyed by Cognito sub)
Cognito —app session code→ [Client]
```

The `aud` trap was the bug we fixed earlier today — the wrapper used to set `aud` to GitHub's OAuth client ID (`Ov23limmWZkbN4QDG0Pm`) instead of the Cognito-passed `client_id` (`solo-desktop`). See §9.

### After sign-in, talking to app APIs

`/v1/*` on the Solo API Gateway is gated by Cognito's `HttpJwtAuthorizer`. Every request must carry `Authorization: Bearer <Cognito access_token>`. The desktop exposes this token via `auth_get_access_token` Tauri command; solo-web exposes it as `session.accessToken` from NextAuth.

---

## 8. Where are the logs?

| Thing | Location |
|---|---|
| `solo-gh-oidcWrapper-dev` | CloudWatch: `/aws/lambda/solo-gh-oidcWrapper-dev` — `aws logs tail /aws/lambda/solo-gh-oidcWrapper-dev --profile solo --since 15m` |
| Same for `solo-gh-postAuth-dev`, `getToken`, `linkStart`, `unlink` | CloudWatch `/aws/lambda/solo-gh-<name>-dev` |
| Cognito federation events | CloudTrail — filter `eventSource=cognito-idp.amazonaws.com` |
| NextAuth server-side | Terminal running `bun dev` |
| NextAuth client-side | Browser DevTools Console (every sign-in error arrives as `?error=...` on `/signin`) |
| Desktop Rust | Terminal running `bun run dev`; filter `auth_commands` |
| Desktop React | Right-click app → Inspect (Tauri devtools enabled in dev) |
| DynamoDB inspect | `aws dynamodb scan --profile solo --table-name solo-github-tokens-dev --max-items 5` |

### Decoding a NextAuth `error=...` URL param

| Value | Meaning | Where to look |
|---|---|---|
| `OAuthCallbackError` | Cognito or NextAuth rejected the id_token or code | Cognito's redirect will carry `error_description=...` — **decode this for the real cause** |
| `OAuthSigninError` | Could not reach the provider's /authorize | Wrapper Lambda logs; usually an IAM/secrets issue |
| `AccessDenied` | User closed the browser window / denied permission | No action needed |
| `Configuration` | NextAuth env missing | Check `.env.local` |

---

## 9. The current GitHub-web bug

### Symptoms
- Click **Continue with GitHub** on `/signin`.
- Browser opens Cognito Hosted UI → GitHub → authorize → back through wrapper `/callback`.
- Then redirects to `http://localhost:3000/api/auth/callback/cognito?error_description=…&error=invalid_request`.
- Before that landed, we'd see this `error_description` (URL-decoded):
  ```
  Bad id_token aud [Ov23limmWZkbN4QDG0Pm]
  ```
  Meaning Cognito rejected the id_token because its `aud` claim was GitHub's OAuth app client id instead of `solo-desktop`.

### Fix already landed (may need cache bust)
`solo/infra/lambda/github/oidcHandler.ts` `token()` now:

1. Extracts the RP's `client_id` from the POST body *or* the `Authorization: Basic` header (per RFC 6749 §2.3.1).
2. Uses that value as the `aud` on the signed id_token.

Deployed via `bunx cdk deploy SoloGitHub-dev --context stage=dev --profile solo`.

### Separate IAM fix also landed (earlier 500)
The oidcWrapper's IAM role allowed `GetSecretValue` on `…github-oidc-client-??????` — a wildcard requiring a 6-char suffix. The Lambda was calling `GetSecretValue(SecretId=<partial ARN without suffix>)`, which IAM evaluated literally, and the wildcard didn't match. Fix:
- `infra/lib/github-stack.ts`: pass **`githubSecret.secretName`** instead of `.secretArn` as `GITHUB_SECRET_NAME`.
- `infra/lambda/github/shared.ts`: read `GITHUB_SECRET_NAME` (falls back to legacy `GITHUB_SECRET_ARN` for backward compat).

### If GitHub web sign-in still 500s after the above

Possible remaining causes, in order of likelihood:

1. **Lambda cold code not swapped yet** — force a redeploy: `bunx cdk deploy SoloGitHub-dev --context stage=dev --profile solo --require-approval never`. Then:
   ```bash
   aws --profile solo logs tail /aws/lambda/solo-gh-oidcWrapper-dev --since 5m --format short
   ```
   A fresh run should show the new log line emitted in `token()`.
2. **GitHub OAuth App callback URL drift** — verify the app's "Authorization callback URL" at https://github.com/settings/developers exactly matches the wrapper callback: `https://3b7g774mq7.execute-api.us-east-1.amazonaws.com/callback`. Any mismatch (http/https, trailing slash, stage path) breaks the code redeem.
3. **Cognito post-authentication trigger failing** — if `solo-gh-postAuth-dev` throws, Cognito returns a 500 to the client. Tail its log group:
   ```bash
   aws --profile solo logs tail /aws/lambda/solo-gh-postAuth-dev --since 5m --format short
   ```
   A common failure mode there is KMS/DynamoDB permission errors on the tokens-table encryption key.
4. **Cognito GitHub IdP attribute mapping mismatch** — if the id_token lacks a claim Cognito maps as required (`email`, `sub`, `preferred_username`, etc.), Cognito fails the federation. Current mapping:
   ```
   email              → email
   name               → name
   picture            → picture
   preferred_username → preferred_username
   username           → sub
   ```
   Our wrapper currently mints all five. If a new user signs in with a private GitHub email, `email` might be `null` → sign-in fails. Fallback already in the code: `${ghUser.login}@users.noreply.github.com`.
5. **NextAuth state cookie size** — `authjs.state` and `authjs.pkce.code_verifier` together can exceed browser header limits in some flows. Symptoms: 431 Request Header Too Large, not 500, but worth noting.
6. **Next.js dev server 500** — check the terminal running `bun dev` for an unhandled exception inside `/api/auth/callback/cognito`. This route is a NextAuth handler, so failures here usually indicate a NextAuth config issue (missing env, provider misconfig).

### Diagnostics script (run while reproducing)

```bash
# 1. In one terminal, tail the wrapper.
aws --profile solo logs tail /aws/lambda/solo-gh-oidcWrapper-dev --follow --format short

# 2. In another, tail post-auth.
aws --profile solo logs tail /aws/lambda/solo-gh-postAuth-dev --follow --format short

# 3. In a third, start solo-web.
cd solo-web && bun dev

# 4. Reproduce. Save the browser Network tab HAR.
# 5. The sequence should be:
#    GET  /authorize → 302 github.com
#    (user authorizes)
#    GET  /callback  → 302 cognito.com/oauth2/idpresponse
#    POST /token     → 200 with id_token in JSON body
#    GET  /userinfo  → 200 with user claims
#    GET  /api/auth/callback/cognito → 302 to callbackUrl (or /signin?error=… on failure)
```

Whichever step goes non-2xx first is the bug.

---

## 10. Known-good test accounts + seeded rows

| Email | In `admin_users` | In `allowed_users` |
|---|---|---|
| `sa9082@nyu.edu` | ✓ | ✓ (self-seeded during setup) |

To seed more admins:
```bash
DB_PASSWORD=$(aws --profile solo secretsmanager get-secret-value --secret-id solo/dev/rds-admin --query SecretString --output text | jq -r '.password')
PGPASSWORD="$DB_PASSWORD" psql -h solo-db-dev.cgxcqy6sq3vr.us-east-1.rds.amazonaws.com -U solo_admin -d solo -p 5432 -c "
  INSERT INTO admin_users (email) VALUES ('someone@example.com') ON CONFLICT DO NOTHING;
  INSERT INTO allowed_users (email, name, added_by) VALUES ('someone@example.com', 'Someone', 'bootstrap') ON CONFLICT DO NOTHING;
"
```

Role flags (`isAllowed`, `isAdmin`) are computed at sign-in and stashed in the NextAuth JWT. Changes to these tables take effect on the user's **next sign-in** — no hot-reload.

---

## 11. Gotchas & lessons learned

- **Two `client_id`s in the GitHub flow** that are NOT the same: (a) GitHub OAuth App's (`Ov23limm…`) — used to talk to GitHub; (b) the OIDC client id Cognito was handed when the IdP was registered (`solo-desktop`) — used as `aud` on the id_token we return to Cognito. Conflating them is the `Bad id_token aud` bug in §9.
- **Secrets Manager + IAM**: `fromSecretNameV2(...).secretArn` emits the suffix-less ARN. If you pass that to `GetSecretValue(SecretId=<that ARN>)`, IAM evaluates literally and the `-??????` wildcard grant won't match. Pass the secret *name* instead.
- **`newer pg` + `sslmode=require`**: recent `pg@9.x` treats `require` as `verify-full`. Append `&uselibpqcompat=true` to `DATABASE_URL` to restore old semantics, or the Drizzle client errors at query time.
- **NextAuth edge runtime**: `middleware.ts` runs under Next's edge runtime, which cannot import `pg`/`crypto`. Put DB-touching callbacks in `lib/auth.ts` and re-export an edge-safe config from `lib/auth.config.ts` (providers only). `middleware.ts` imports only the edge-safe version.
- **Desktop dev mode bypass**: `AuthGuard` short-circuits if `VITE_AUTH_ENABLED !== '1'`. Forgotten by new devs → "sign-in doesn't seem to do anything". See §6.
- **Cognito `LogoutURL` list** is independent of the callback URL list. Adding a new origin requires both. Current list: `http://localhost:3000`, `https://solo.dev`, `soloide://auth/signout`.
- **Cognito User Pool user is created on first federation.** If you change the attribute mapping *after* the first sign-in, Cognito does NOT re-sync; you must delete the user in the pool for the new mapping to take effect on their next sign-in.

---

## 12. What's done vs. remaining

**Done**
- CDK stacks deployed; all 6 `Solo*-dev` stacks complete.
- GitHub OAuth App registered; callback URL + scopes correct.
- OIDC wrapper Lambda handles discovery, jwks, authorize, callback, token, userinfo.
- Cognito IdP configured for GitHub using the wrapper; attribute mapping set.
- Both client surfaces integrate with NextAuth / Tauri auth commands.
- Google sign-in works on **desktop** and **web**.
- GitHub sign-in works on **desktop**.
- `aud` bug fixed in the wrapper; new Lambda code deployed.
- IAM wildcard-vs-literal ARN bug fixed (Lambda now reads secret by name).

**Remaining (this is what the next person picks up)**
- GitHub sign-in on **solo-web** returns 500 at the very end of the flow. See §9 for the exact flow to debug. Most likely cause at this point is the post-auth trigger or Cognito attribute mapping, since the `aud` and IAM bugs are fixed upstream.
- Once GitHub web sign-in works end-to-end, verify:
  - A row appears in `solo-github-tokens-dev` for the user.
  - `GET /v1/github/token` returns the stored access token.
  - The access token works against `https://api.github.com/user`.
- Prod deploy: duplicate all of the above for the `prod` stage. The `deploy:prod` script exists (`infra/package.json`); separate secrets / callback URLs are needed.

---

## 13. Quick-reference file tour

**OIDC wrapper (all GitHub auth server-side code):**
- `solo/infra/lambda/github/oidcHandler.ts` — wrapper endpoints (`/authorize`, `/callback`, `/token`, `/userinfo`, discovery, jwks)
- `solo/infra/lambda/github/linkStart.ts` — `POST /v1/github/link`
- `solo/infra/lambda/github/getToken.ts` — `GET /v1/github/token`
- `solo/infra/lambda/github/unlink.ts` — `DELETE /v1/github/link`
- `solo/infra/lambda/github/postAuth.ts` — Cognito post-authentication trigger
- `solo/infra/lambda/github/shared.ts` — shared helpers (`getSecret`, `signJwtRs256`, state signing, etc.)
- `solo/infra/lib/github-stack.ts` — CDK: Lambdas, DynamoDB tables, KMS keys, IAM

**CDK infra:**
- `solo/infra/lib/auth-stack.ts` — Cognito user pool, app client, identity pool, Google IdP
- `solo/infra/lib/api-stack.ts` — `/v1/*` API Gateway, Cognito JWT authorizer, route wiring
- `solo/infra/lib/rds-stack.ts` — `solo-db-dev` Postgres, Secrets Manager for admin creds
- `solo/infra/.env.dev` — generated outputs

**Desktop auth:**
- `solo/apps/desktop/src-tauri/src/auth_commands.rs` — all Tauri auth commands (sign-in, exchange, refresh, sign-out, get token)
- `solo/apps/desktop/src/lib/auth.ts` — TS wrapper around the Tauri invokes
- `solo/apps/desktop/src/stores/authStore.ts` — Zustand store for auth state
- `solo/apps/desktop/src/components/auth/LoginScreen.tsx` — the sign-in UI
- `solo/apps/desktop/src/components/auth/AuthGuard.tsx` — dev bypass lives here

**Web auth:**
- `solo-web/lib/auth.ts` — NextAuth config with DB-touching `jwt`/`session` callbacks (Node-only)
- `solo-web/lib/auth.config.ts` — edge-safe subset used by middleware
- `solo-web/middleware.ts` — gates `/beta`, `/admin`, `/account`, `/dashboard`
- `solo-web/types/next-auth.d.ts` — Session/JWT type augmentation for `isAllowed`/`isAdmin`
- `solo-web/app/api/auth/[...nextauth]/route.ts` — NextAuth handler
- `solo-web/components/user-auth-form.tsx` — sign-in UI
- `solo-web/components/user-menu.tsx` — signed-in avatar + sign-out

---

## 14. Redeploying the wrapper (runbook for the fix)

```bash
cd /Users/sachin/Developer/Orbit_Main/solo/infra

# Make your code changes under lambda/github/ or lib/github-stack.ts.

bunx tsc --noEmit      # type-check
bunx cdk diff SoloGitHub-dev --context stage=dev --profile solo     # see what changes
bunx cdk deploy SoloGitHub-dev --context stage=dev --profile solo --require-approval never

# Watch the Lambda pick up the new code:
aws --profile solo logs tail /aws/lambda/solo-gh-oidcWrapper-dev --follow --format short
```

Redeploy runs in ~25 seconds. Lambda version is updated in place; no downtime.

---

## 15. Contact points

- AWS account: `465443875827`, region `us-east-1`, profile `solo`
- GitHub OAuth App: owner of the account has access at https://github.com/settings/developers; look for `Ov23limmWZkbN4QDG0Pm`
- DNS / Vercel: `solo.dev` is the prod domain (not yet deployed from this branch)

When the next person hits a failure, the single most useful first move is:
```bash
aws --profile solo logs tail /aws/lambda/solo-gh-oidcWrapper-dev --follow --format short
```
…reproduce the sign-in, and read the log chronologically. The `sub`, `aud`, and any `internal_error` message carry the answer.
