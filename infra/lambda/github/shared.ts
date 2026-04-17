import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { KMSClient, SignCommand, GetPublicKeyCommand } from "@aws-sdk/client-kms";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const region = process.env.AWS_REGION_OVERRIDE ?? process.env.AWS_REGION ?? "us-east-1";

export const sm = new SecretsManagerClient({ region });
export const kms = new KMSClient({ region });
export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
  marshallOptions: { removeUndefinedValues: true },
});

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const secretCache = new Map<string, { value: string; cachedAt: number }>();
const SECRET_TTL_MS = 60_000;

export async function getSecret(arn: string): Promise<string> {
  const now = Date.now();
  const cached = secretCache.get(arn);
  if (cached && now - cached.cachedAt < SECRET_TTL_MS) return cached.value;
  const out = await sm.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!out.SecretString) throw new Error(`Secret ${arn} has no string value`);
  secretCache.set(arn, { value: out.SecretString, cachedAt: now });
  return out.SecretString;
}

export async function getGitHubOauthCreds(): Promise<{ clientId: string; clientSecret: string }> {
  // Accept either GITHUB_SECRET_NAME (preferred) or the legacy
  // GITHUB_SECRET_ARN env var during the deploy transition. The SDK accepts
  // both names and ARNs as `SecretId`, but using the *name* is what lets
  // IAM's `-??????` wildcard grant match.
  const s = await getSecret(
    process.env.GITHUB_SECRET_NAME ?? env("GITHUB_SECRET_ARN"),
  );
  const parsed = JSON.parse(s);
  if (!parsed.clientId || !parsed.clientSecret) {
    throw new Error("GitHub secret missing clientId or clientSecret");
  }
  return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
}

export async function getStateSigningSecret(): Promise<string> {
  return await getSecret(env("STATE_SIGNING_SECRET_ARN"));
}

export function b64url(buf: Buffer | Uint8Array | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : Buffer.from(buf);
  return b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export async function signJwtRs256(header: object, payload: object): Promise<string> {
  const kid = await getSigningKeyKid();
  const fullHeader = { ...header, alg: "RS256", typ: "JWT", kid };
  const signingInput = `${b64url(JSON.stringify(fullHeader))}.${b64url(JSON.stringify(payload))}`;
  const out = await kms.send(
    new SignCommand({
      KeyId: env("JWT_SIGNING_KEY_ID"),
      Message: Buffer.from(signingInput),
      MessageType: "RAW",
      SigningAlgorithm: "RSASSA_PKCS1_V1_5_SHA_256",
    }),
  );
  if (!out.Signature) throw new Error("KMS signature missing");
  return `${signingInput}.${b64url(Buffer.from(out.Signature))}`;
}

let cachedKidPromise: Promise<string> | undefined;
export function getSigningKeyKid(): Promise<string> {
  if (!cachedKidPromise) {
    cachedKidPromise = (async () => {
      const keyId = env("JWT_SIGNING_KEY_ID");
      const h = createHmac("sha256", "solo-github-jwks-kid");
      h.update(keyId);
      return h.digest("hex").slice(0, 16);
    })();
  }
  return cachedKidPromise;
}

export async function getJwksDocument(): Promise<{
  keys: Array<{ kty: string; use: string; alg: string; kid: string; n: string; e: string }>;
}> {
  const out = await kms.send(new GetPublicKeyCommand({ KeyId: env("JWT_SIGNING_KEY_ID") }));
  if (!out.PublicKey) throw new Error("KMS did not return a public key");
  const spki = Buffer.from(out.PublicKey);
  const { modulus, exponent } = parseRsaSpki(spki);
  const kid = await getSigningKeyKid();
  return {
    keys: [
      {
        kty: "RSA",
        use: "sig",
        alg: "RS256",
        kid,
        n: b64url(modulus),
        e: b64url(exponent),
      },
    ],
  };
}

function parseRsaSpki(spki: Buffer): { modulus: Buffer; exponent: Buffer } {
  let i = 0;
  function readLen(): number {
    const first = spki[i++];
    if ((first & 0x80) === 0) return first;
    const n = first & 0x7f;
    let len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | spki[i++];
    return len;
  }
  function expect(tag: number): number {
    if (spki[i++] !== tag) throw new Error(`SPKI parse: expected tag 0x${tag.toString(16)}`);
    return readLen();
  }
  expect(0x30);
  const algLen = expect(0x30);
  i += algLen;
  expect(0x03);
  i += 1;
  expect(0x30);
  const modLen = expect(0x02);
  const modulus = spki.subarray(i, i + modLen);
  i += modLen;
  const expLen = expect(0x02);
  const exponent = spki.subarray(i, i + expLen);
  const modTrimmed = modulus[0] === 0 ? modulus.subarray(1) : modulus;
  return { modulus: modTrimmed, exponent };
}

export async function signState(payload: object, ttlSeconds = 600): Promise<string> {
  const secret = await getStateSigningSecret();
  const fullPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds, nonce: randomBytes(8).toString("hex") };
  const body = b64url(JSON.stringify(fullPayload));
  const sig = b64url(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export async function verifyState<T = Record<string, unknown>>(token: string): Promise<T> {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("Malformed state token");
  const secret = await getStateSigningSecret();
  const expectedSig = b64url(createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid state signature");
  const payload = JSON.parse(b64urlDecode(body).toString("utf-8"));
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("State token expired");
  }
  return payload as T;
}

export function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

export function redirect(url: string) {
  return {
    statusCode: 302,
    headers: { location: url },
    body: "",
  };
}

export function text(status: number, body: string, extra: Record<string, string> = {}) {
  return {
    statusCode: status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extra },
    body,
  };
}
