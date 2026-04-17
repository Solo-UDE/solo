# Solo Infra — One-Time Setup

Follow this in order. You'll need to do browser steps for GitHub and Google OAuth. Everything else I can automate.

---

## 1. GitHub OAuth App (dev)

Open: **https://github.com/settings/developers**

Click **OAuth Apps** (left nav) → **New OAuth App**.

Fill in:

| Field | Value |
|-------|-------|
| Application name | `Solo IDE (dev)` |
| Homepage URL | `https://solo.dev` (or any valid URL — e.g. your GitHub) |
| Application description | `Solo IDE desktop app — dev environment` (optional) |
| Authorization callback URL | `https://solo-ide-dev.auth.us-east-1.amazoncognito.com/oauth2/idpresponse` |

Click **Register application**.

On the resulting page:
1. Copy the **Client ID** — paste it somewhere safe
2. Click **Generate a new client secret** → copy the secret immediately (shown only once)

Paste both into AWS Secrets Manager once CDK creates the secret. Commands to run *after* first deploy:

```bash
aws secretsmanager put-secret-value \
  --profile solo \
  --secret-id solo/dev/github-oidc-client \
  --secret-string '{"clientId":"PASTE_CLIENT_ID","clientSecret":"PASTE_CLIENT_SECRET"}'
```

### GitHub OAuth App (prod) — do later when you're ready to launch

Same as above but with:
- Application name: `Solo IDE`
- Callback URL: `https://solo-ide-prod.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
- Secret goes into `solo/prod/github-oidc-client`

---

## 2. Google OAuth Client (dev)

Open: **https://console.cloud.google.com**

**2a. Create a project**
1. Top-left project dropdown → **New Project**
2. Project name: `Solo IDE`
3. Click **Create**, then select the new project

**2b. Configure OAuth consent screen**
1. Go to **APIs & Services** → **OAuth consent screen**
2. User Type: **External** → **Create**
3. Fill in:
   - App name: `Solo IDE`
   - User support email: your email
   - Developer contact email: your email
4. Click **Save and Continue**
5. **Scopes**: click **Add or Remove Scopes** → check `.../auth/userinfo.email` and `.../auth/userinfo.profile` and `openid`
6. Click **Save and Continue** twice through to the end

**2c. Create OAuth Client ID**
1. Go to **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `Solo IDE (dev)`
5. Authorized redirect URIs → **Add URI**:
   `https://solo-ide-dev.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
6. Click **Create**

Copy the **Client ID** and **Client Secret** from the popup (also downloadable as JSON).

Once CDK creates the secret, paste them in:

```bash
aws secretsmanager put-secret-value \
  --profile solo \
  --secret-id solo/dev/google-oidc-client \
  --secret-string '{"clientId":"PASTE_CLIENT_ID","clientSecret":"PASTE_CLIENT_SECRET"}'
```

### Google OAuth Client (prod) — when ready to launch

Same app, just add another OAuth Client:
- Name: `Solo IDE (prod)`
- Redirect URI: `https://solo-ide-prod.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
- Put in secret `solo/prod/google-oidc-client`

---

## 3. AWS CDK Bootstrap (one-time per account)

```bash
cd solo/infra
bun install
bun run bootstrap:dev
```

This creates the CDK toolkit stack (`CDKToolkit`) in `us-east-1` — an S3 bucket and IAM roles CDK needs for deploys. Only has to be done once per account+region.

## 4. Deploy dev stage

```bash
bun run deploy:dev
```

CDK synthesizes all four stacks (`SoloAuth-dev`, `SoloData-dev`, `SoloApi-dev`, `SoloStorage-dev`) and deploys them. Takes ~5 minutes the first time.

After deploy, look for outputs like:
```
SoloAuth-dev.CognitoDomain = solo-ide-dev.auth.us-east-1.amazoncognito.com
SoloAuth-dev.UserPoolId    = us-east-1_XXXXXXXXX
SoloAuth-dev.UserPoolClientId = xxxxxxxxxxxxxxxxxxxxxxxxxx
SoloApi-dev.ApiEndpoint    = https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com
```

Put these into `solo/infra/.env.dev` (gitignored) and the Solo desktop app will read them as build-time env vars.

## 5. Verify end-to-end

1. Put the GitHub + Google client IDs/secrets into Secrets Manager (step 1 + 2 above)
2. Cognito picks them up automatically (via `SecretValue.secretsManager` references)
3. Launch Solo desktop, click **Continue with GitHub** → browser → authenticate → deep-link back → logged in

If anything fails, check CloudWatch logs in the AWS console under `/aws/lambda/{function-name}`.

---

## Destroy (tearing down dev)

```bash
bun run destroy:dev
```

DynamoDB tables have `removal policy = destroy` in dev and `retain` in prod, so this is safe in dev but irreversibly drops data. Prod protected by default.
