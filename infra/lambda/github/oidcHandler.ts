import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  b64urlDecode,
  ddb,
  env,
  getGitHubOauthCreds,
  getJwksDocument,
  json,
  redirect,
  signJwtRs256,
  text,
  verifyState,
} from "./shared.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";
const REQUESTED_SCOPES = "read:user user:email repo workflow";

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const route = event.routeKey;
  try {
    switch (route) {
      case "GET /.well-known/openid-configuration":
        return await discovery();
      case "GET /.well-known/jwks.json":
        return await jwks();
      case "GET /authorize":
        return await authorize(event);
      case "GET /callback":
        return await callback(event);
      case "POST /token":
        return await token(event);
      case "GET /userinfo":
        return await userinfo(event);
      default:
        return json(404, { error: "not_found", route });
    }
  } catch (err) {
    console.error("OIDC wrapper error:", err);
    return json(500, { error: "internal_error", detail: (err as Error).message });
  }
};

async function discovery(): Promise<APIGatewayProxyStructuredResultV2> {
  const issuer = env("OIDC_ISSUER");
  return json(200, {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "email", "profile"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    claims_supported: ["sub", "email", "email_verified", "name", "preferred_username", "picture"],
  });
}

async function jwks(): Promise<APIGatewayProxyStructuredResultV2> {
  const doc = await getJwksDocument();
  return json(200, doc, { "cache-control": "public, max-age=3600" });
}

async function authorize(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const qs = event.queryStringParameters ?? {};
  const cognitoRedirect = qs.redirect_uri;
  const cognitoState = qs.state;
  if (!cognitoRedirect || !cognitoState) {
    return text(400, "missing redirect_uri or state");
  }
  const { clientId } = await getGitHubOauthCreds();
  const ownCallback = `${env("OIDC_ISSUER")}/callback`;
  const ourState = encodeURIComponent(
    JSON.stringify({ redirect_uri: cognitoRedirect, cognito_state: cognitoState }),
  );
  const u = new URL(GITHUB_AUTHORIZE_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", ownCallback);
  u.searchParams.set("scope", REQUESTED_SCOPES);
  u.searchParams.set("state", ourState);
  u.searchParams.set("allow_signup", "true");
  return redirect(u.toString());
}

async function callback(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const qs = event.queryStringParameters ?? {};
  const code = qs.code;
  const state = qs.state;
  if (!code || !state) return text(400, "missing code or state");

  if (isSignInState(state)) {
    return signInCallback(state, code);
  }
  return linkCallback(state, code);
}

function isSignInState(state: string): boolean {
  try {
    const decoded = decodeURIComponent(state);
    if (!decoded.startsWith("{")) return false;
    const parsed = JSON.parse(decoded);
    return typeof parsed?.cognito_state === "string" && typeof parsed?.redirect_uri === "string";
  } catch {
    return false;
  }
}

async function signInCallback(state: string, code: string): Promise<APIGatewayProxyStructuredResultV2> {
  const wrapperState = JSON.parse(decodeURIComponent(state));
  const { redirect_uri: cognitoRedirect, cognito_state: cognitoState } = wrapperState;
  const u = new URL(cognitoRedirect);
  u.searchParams.set("code", code);
  u.searchParams.set("state", cognitoState);
  return redirect(u.toString());
}

async function linkCallback(state: string, code: string): Promise<APIGatewayProxyStructuredResultV2> {
  let payload: { userId: string; kind: string };
  try {
    payload = await verifyState<{ userId: string; kind: string }>(state);
  } catch (err) {
    console.error("state verify failed:", err);
    return text(400, "invalid state");
  }
  if (payload.kind !== "link") return text(400, "wrong state kind");

  const { clientId, clientSecret } = await getGitHubOauthCreds();
  const ownCallback = `${env("OIDC_ISSUER")}/callback`;

  const tokenResp = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: ownCallback,
    }).toString(),
  });
  const tokenJson = (await tokenResp.json()) as { access_token?: string; scope?: string };
  if (!tokenJson.access_token) return text(400, "token exchange failed");

  const userResp = await fetch(GITHUB_USER_URL, {
    headers: {
      authorization: `Bearer ${tokenJson.access_token}`,
      accept: "application/json",
      "user-agent": "solo-ide-link",
    },
  });
  if (!userResp.ok) return text(502, "github user fetch failed");
  const gh = (await userResp.json()) as { id: number; login: string };

  await ddb.send(
    new PutCommand({
      TableName: env("TOKENS_TABLE"),
      Item: {
        userId: payload.userId,
        access_token: tokenJson.access_token,
        github_login: gh.login,
        github_user_id: `github:${gh.id}`,
        github_numeric_id: gh.id,
        granted_scopes: tokenJson.scope ?? "",
        linked_at: new Date().toISOString(),
        source: "link",
      },
    }),
  );

  return redirect("soloide://github/linked?success=1");
}

async function token(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const body = parseForm(event.body, event.isBase64Encoded);
  const code = body.get("code");
  if (!code) return json(400, { error: "invalid_request", error_description: "missing code" });

  // Cognito (the RP) identifies itself to us with its own client_id — that's
  // what must appear in the id_token `aud`. Per RFC 6749 §2.3.1 the creds
  // can arrive either as form fields or HTTP Basic in `Authorization`. We
  // accept both, prefer the form value.
  const rpClientId = body.get("client_id") ?? basicAuthClientId(event);
  if (!rpClientId) {
    return json(400, {
      error: "invalid_request",
      error_description: "missing client_id (form or Basic auth)",
    });
  }

  // GitHub app credentials — used only to exchange the code with GitHub.
  // These are NOT the RP credentials; conflating the two was the original
  // "Bad id_token aud" bug.
  const { clientId: githubClientId, clientSecret: githubClientSecret } =
    await getGitHubOauthCreds();
  const ownCallback = `${env("OIDC_ISSUER")}/callback`;

  const tokenResp = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: githubClientId,
      client_secret: githubClientSecret,
      code,
      redirect_uri: ownCallback,
    }).toString(),
  });
  const tokenJson = await tokenResp.json() as { access_token?: string; scope?: string; error?: string; error_description?: string };
  if (!tokenJson.access_token) {
    return json(400, {
      error: tokenJson.error ?? "token_exchange_failed",
      error_description: tokenJson.error_description ?? "GitHub did not return an access_token",
    });
  }

  const userResp = await fetch(GITHUB_USER_URL, {
    headers: { authorization: `Bearer ${tokenJson.access_token}`, accept: "application/json", "user-agent": "solo-ide-oidc-wrapper" },
  });
  if (!userResp.ok) {
    return json(502, { error: "github_user_fetch_failed", status: userResp.status });
  }
  const ghUser = await userResp.json() as { id: number; login: string; name?: string; email?: string; avatar_url?: string };

  let verifiedEmail: string | undefined = ghUser.email ?? undefined;
  let emailVerified = false;
  if (!verifiedEmail) {
    const emailResp = await fetch(GITHUB_EMAILS_URL, {
      headers: { authorization: `Bearer ${tokenJson.access_token}`, accept: "application/json", "user-agent": "solo-ide-oidc-wrapper" },
    });
    if (emailResp.ok) {
      const emails = await emailResp.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      if (primary) {
        verifiedEmail = primary.email;
        emailVerified = primary.verified;
      }
    }
  } else {
    emailVerified = true;
  }

  const subValue = `github:${ghUser.id}`;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuer = env("OIDC_ISSUER");

  const ttl = Math.floor(Date.now() / 1000) + 15 * 60;
  await ddb.send(
    new PutCommand({
      TableName: env("PENDING_TABLE"),
      Item: {
        github_user_id: subValue,
        access_token: tokenJson.access_token,
        github_login: ghUser.login,
        github_numeric_id: ghUser.id,
        granted_scopes: tokenJson.scope ?? REQUESTED_SCOPES,
        ttl,
      },
    }),
  );

  const idToken = await signJwtRs256(
    {},
    {
      iss: issuer,
      sub: subValue,
      aud: rpClientId,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
      email: verifiedEmail ?? `${ghUser.login}@users.noreply.github.com`,
      email_verified: emailVerified,
      name: ghUser.name ?? ghUser.login,
      preferred_username: ghUser.login,
      picture: ghUser.avatar_url,
    },
  );

  return json(200, {
    access_token: tokenJson.access_token,
    id_token: idToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: "openid email profile",
  });
}

async function userinfo(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const auth = event.headers?.authorization ?? event.headers?.Authorization;
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return json(401, { error: "invalid_token", error_description: "missing bearer token" });
  }
  const ghToken = auth.slice(7);
  const resp = await fetch(GITHUB_USER_URL, {
    headers: { authorization: `Bearer ${ghToken}`, accept: "application/json", "user-agent": "solo-ide-oidc-wrapper" },
  });
  if (!resp.ok) return json(401, { error: "invalid_token" });
  const u = await resp.json() as { id: number; login: string; name?: string; email?: string; avatar_url?: string };
  return json(200, {
    sub: `github:${u.id}`,
    name: u.name ?? u.login,
    preferred_username: u.login,
    email: u.email ?? `${u.login}@users.noreply.github.com`,
    email_verified: Boolean(u.email),
    picture: u.avatar_url,
  });
}

function parseForm(body: string | undefined, isBase64: boolean | undefined): Map<string, string> {
  if (!body) return new Map();
  const decoded = isBase64 ? b64urlDecode(body).toString("utf-8") : body;
  const params = new URLSearchParams(decoded);
  const map = new Map<string, string>();
  params.forEach((v, k) => map.set(k, v));
  return map;
}

/**
 * Extract the `client_id` from an `Authorization: Basic …` header if
 * present, per RFC 6749 §2.3.1. Returns null when the header is absent,
 * non-Basic, or malformed. We don't validate the secret here — the wrapper
 * acts only on what the RP tells us and the `aud` check in the downstream
 * IdP (Cognito) is the real authorization gate.
 */
function basicAuthClientId(event: APIGatewayProxyEventV2): string | null {
  const headers = event.headers;
  if (!headers) return null;
  const raw = headers.authorization ?? headers.Authorization;
  if (typeof raw !== "string" || !raw.toLowerCase().startsWith("basic ")) {
    return null;
  }
  try {
    const decoded = Buffer.from(raw.slice(6).trim(), "base64").toString("utf-8");
    const colonAt = decoded.indexOf(":");
    if (colonAt === -1) return null;
    // client_id in Basic auth is URL-encoded per RFC 6749.
    return decodeURIComponent(decoded.slice(0, colonAt));
  } catch {
    return null;
  }
}
