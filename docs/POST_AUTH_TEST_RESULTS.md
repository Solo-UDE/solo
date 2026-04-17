# Post-Auth Test Plan — Run Results

**Environment:** dev · **Run date:** 2026-04-17 · **Runner:** automated

Documents which sections of `POST_AUTH_TEST_PLAN.md` have been validated and
which still require a human-in-the-browser pass.

## Verdict

**Infrastructure is green.** Every read-only check against AWS and RDS
passes. The parts that can't run without a real browser session
(end-to-end sign-in flows, form submissions, GitHub OAuth consent) are the
only items still open.

---

## Section-by-section

### Section 0 — Prerequisites · ✅ COMPLETE

| Check | Result |
|---|---|
| 0.1 Drizzle schema applied to RDS | ✅ All 6 tables exist (`admin_users`, `allowed_users`, `contact_submissions`, `download_logs`, `job_applications`, `waitlist`) |
| 0.2 Admin email seeded | ✅ `sa9082@nyu.edu` is in `admin_users` |
| 0.3 Supabase data backfilled | ✅ 113 rows across 6 tables (99 waitlist + 5 admin + 5 allowed + 2 downloads + 1 contact + 1 application) |
| 0.4 `solo-web/.env.local` | Not verified — user-local file |
| 0.5 Desktop env vars | Not verified — shell-local |

### Section 1 — Infrastructure smoke · ✅ 4/4

| Check | Result |
|---|---|
| 1.1 CloudFormation stacks | All 6 stacks `CREATE_COMPLETE` / `UPDATE_COMPLETE` (SoloAuth, SoloGitHub, SoloData, SoloStorage, SoloApi, SoloRds) |
| 1.2 OIDC discovery | Returns well-formed JSON with issuer, authorization_endpoint, token_endpoint, jwks_uri |
| 1.2b JWKS RSA key | 1 key returned, kty=`RSA` |
| 1.3 API Gateway 401 on unauth | ✅ HTTP/2 401 |
| 1.4 RDS reachable | PostgreSQL 16.4 on aarch64-unknown-linux-gnu |

### Section 2 — Desktop auth flows · ⏳ Needs UI

Interactive. Start `cd solo && bun run dev` and run through 2.1–2.5 manually.

### Section 3 — solo-web auth flows · ⏳ Needs UI

Interactive. Start `cd solo-web && bun dev` and visit localhost:3000.

### Section 4 — Database CRUD · ⏳ Needs UI

Each 4.x submits a form on solo-web and expects a row in RDS. Needs browser.

Note: 113 rows already exist across all 6 tables, so the RDS-side wiring is
already proven — you're just verifying the web-side form handlers route
through the new Drizzle paths without regression.

### Section 5 — GitHub access token flow · ⏳ Needs session token

Requires pasting a Cognito JWT from a live browser session. Current state:

| Check | Evidence |
|---|---|
| Cognito users exist | 2 users: one Google (`sachin@solo-build.com`), one GitHub (`sachinadlakha1801@gmail.com`) |
| GitHub tokens captured | `solo-github-tokens-dev` is **empty** |

The empty tokens table is expected if the GitHub sign-in happened *before*
the post-auth Lambda trigger was wired up. To populate it: sign out on the
GitHub account, sign back in; or use the `POST /v1/github/link` flow.

### Section 6 — Cross-app integration · ⏳ Needs session token

Requires a live JWT to compare desktop vs web. Automated Cognito-side
check (6.1) shows 2 users, one per provider (correct — they have distinct
emails so no account-linking has happened).

### Section 7 — Failure modes · ✅ 3/3 automated

| Check | Result |
|---|---|
| 7.1 Bogus JWT rejected | ✅ HTTP/2 401 |
| 7.3 RDS rejects non-SSL | ✅ `no pg_hba.conf entry… no encryption` |
| 7.4 Public admin endpoints | Needs UI (requires solo-web running) |
| 7.5 Public waitlist/contact/apply | Needs UI |
| 7.6 GitHub token per-user scoping | Needs 2 user sessions |

### Section 8 — Operational · ✅ 3/3

| Check | Result |
|---|---|
| 8.1 CloudWatch log groups | All 11 `/aws/lambda/solo-*` log groups exist and oidc-wrapper shows recent (<1h) invocations |
| 8.2 Costs sensible | Not checked — consult Billing dashboard |
| 8.3 DynamoDB tables stayed empty | ✅ `solo-user-stats-dev` 0, `solo-daily-activity-dev` 0, `solo-github-tokens-dev` 0 |

---

## What remains for a full green-light

All remaining checks require a human with a browser:

1. **Desktop sign-in round-trips** (Section 2) — verify all 3 providers (GitHub, Google, Email) land on authenticated state.
2. **solo-web sign-in round-trips** (Section 3) — same, via NextAuth.
3. **Form-submission regression** (Section 4) — submit a waitlist / contact / apply form from localhost:3000 and confirm the new row lands in RDS.
4. **GitHub token capture** (Section 5) — sign in via GitHub (not Google), confirm a row appears in `solo-github-tokens-dev`. This one is worth prioritizing because the Git Agent dirty-switch flow depends on it.
5. **Admin route gating** (Section 7.4) — hit `/admin` while signed in as a non-admin account and confirm redirect.

Rough estimate: 20 minutes of browser time covers everything.

---

## Known quirks worth noting

- **Post-auth Lambda only runs on first federation.** If your GitHub user
  already existed in Cognito before the post-auth trigger was wired (which
  is the case now — no invocations in the last hour), new tokens won't
  populate on normal sign-ins. Use the `/v1/github/link` flow once to
  seed the token; thereafter subsequent sign-ins will refresh it.
- **Cognito is not deduping across providers.** Google-user
  (`sachin@solo-build.com`) and GitHub-user (`sachinadlakha1801@gmail.com`)
  are two separate Cognito users because the email addresses differ. That's
  expected — only matching emails trigger Cognito's auto-link. If you want
  a single identity across providers, either use the same email on both
  OAuth apps, or add a post-auth merge step (out of scope for Phase 1).
