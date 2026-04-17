# Outstanding: purge leaked OAuth secrets from git history

**Status:** deferred — repo is private, no external collaborators, secrets scheduled for rotation.
**Created:** 2026-04-17
**Owner:** Sachin

## What happened

Commit `1105f9e1 setup` (2026-04-16) added `infra/Oauth_app_setup.md` to the
repo with plaintext OAuth client IDs and secrets for:

- GitHub OAuth App (Solo IDE / dev)
- Google OAuth 2.0 Client (Solo IDE / dev)

The file was meant to be a local scratchpad for the first-time OAuth setup
and should have been gitignored from the start.

## Where the leak lives

The commit `1105f9e1` is reachable from all three of these branches on
`github.com:Solo-UDE/solo` (both `origin` and `github-integ` aliases):

- `codex/ui-shell-composer`
- `dev`
- `master`

`git log --all -- infra/Oauth_app_setup.md` confirms exactly one commit
touches the file (`1105f9e1`), so a single history rewrite clears all three
branches.

## What has been done

- [x] **`.gitignore` updated** with explicit + glob entries
  (`infra/Oauth_app_setup.md`, `infra/oauth*`, `infra/*secret*`,
  `infra/*credential*`, `**/oauth-setup*`). Prevents re-adding via
  `git add .`. Commit: `831da671 chore(gitignore): ignore OAuth setup
  scratchpads and credential files`.
- [x] **File untracked from HEAD** — `git rm --cached` so the current tree
  no longer carries the file. Local disk copy preserved for reference during
  rotation. Commit: `780a9381 chore(infra): untrack Oauth_app_setup.md
  local scratchpad`.
- [ ] **Secrets rotated** (see "Rotate the secrets" section in conversation
  history from 2026-04-16). This is the load-bearing step — history rewrite
  is cleanup, rotation is containment.
- [ ] **Push Protection enabled** at
  https://github.com/Solo-UDE/solo/settings/security_analysis. Blocks
  future accidents where a token pattern is detected in a pushed commit.

## What remains

### 1. Rotate (still the most important thing)

- GitHub OAuth App: regenerate + revoke the old client secret at
  https://github.com/settings/developers → Solo IDE (dev). Push the new
  secret into AWS Secrets Manager (`solo/dev/github-oidc-client`). The
  GitHub OIDC wrapper Lambda reads Secrets Manager on every request, so
  no redeploy needed.
- Google OAuth Client: add a new secret + disable the old one at
  https://console.cloud.google.com → APIs & Services → Credentials. Push
  into Secrets Manager (`solo/dev/google-oidc-client`) **and** re-apply to
  the live Cognito IdP via
  `aws cognito-idp update-identity-provider --user-pool-id us-east-1_S9C2mSy8E
  --provider-name Google --provider-details ...` because Google IdP caches
  the secret at stack-deploy time.

### 2. Purge from history (deferred)

When any of these triggers hit, do the rewrite:

- Repo becomes public.
- A second collaborator joins who could see the history.
- GitHub Support or an auditor needs to investigate something on the repo.
- CI pipelines or build tooling start reading arbitrary historical commits.
- 6 months elapse without the above happening (do it preemptively).

### 3. Rewrite commands (when trigger hits)

Preconditions:
- Nobody is actively pushing to `master`, `dev`, or `codex/ui-shell-composer`.
- Secrets have already been rotated (do this BEFORE the rewrite, not after —
  rewriting first just gives an attacker more time with valid creds).
- All open PRs targeting the affected branches have been merged or closed
  (they will need rebasing otherwise).

Then, from a clean clone:

```bash
# Clean clone so filter-repo has nothing to worry about.
git clone git@github.com:Solo-UDE/solo.git solo-clean
cd solo-clean

# Purge the file from every commit that contains it.
git filter-repo --path infra/Oauth_app_setup.md --invert-paths

# filter-repo removes remotes as a safety — re-add.
git remote add origin git@github.com:Solo-UDE/solo.git

# Force-push each affected branch. --force-with-lease is safer than --force
# because it bails if the remote moved since fetch (prevents clobbering
# someone else's push that landed in the meantime).
git push --force-with-lease origin codex/ui-shell-composer
git push --force-with-lease origin dev
git push --force-with-lease origin master

# Push tags too (if any tag pointed at a rewritten commit).
git push --force origin --tags
```

After the push, contact GitHub Support at https://support.github.com with:

> Private repo `Solo-UDE/solo` had a sensitive file purged via history
> rewrite. Please run garbage collection on the repository and purge the
> CDN / cached views so the old commit object is unreachable. The file
> was `infra/Oauth_app_setup.md`; the commit SHA before the rewrite was
> `1105f9e1` and the branches affected were `codex/ui-shell-composer`,
> `dev`, and `master`.

GitHub keeps unreachable objects for ~90 days by default; Support can
trigger an immediate purge.

### 4. Team coordination (if the team grows before step 2)

Every teammate with a local clone needs:

```bash
git fetch origin
# verify you have no local WIP on the rewritten branches you care about
git reset --hard origin/<branch>
```

**Do not** rebase onto the new history — reset is the safe move because the
rewritten commits have new SHAs, and a rebase would try to replay the
deleted-file commits on top of branches that no longer have them.

## Why the rewrite is deferred today

- Repo is private; access is limited to the small group with write access
  to `Solo-UDE/solo`.
- No external collaborators or forks.
- Secrets will be rotated in the same window, so even a historical reader
  of the old commit can't use the credentials.
- Force-pushing master is destructive enough that doing it during active
  Phase 3 UI work would be a net regression in stability.

The risk profile flips the moment any of the triggers in section 2 hit.
