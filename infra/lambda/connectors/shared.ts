import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

export interface ConnectorTokenItem {
  readonly userId: string;
  readonly connectorKey: string;
  readonly provider: string;
  readonly accountId: string;
  readonly displayName?: string;
  readonly accessToken?: string;
  readonly refreshToken?: string;
  readonly scopes: string[];
  readonly expiresAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function json(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: status,
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  };
}

export function extractUserId(event: APIGatewayProxyEventV2WithJWTAuthorizer): string | undefined {
  return event.requestContext.authorizer.jwt.claims.sub as string | undefined;
}

export function tableName(): string {
  const value = process.env.CONNECTOR_TOKENS_TABLE;
  if (!value) throw new Error("Missing env: CONNECTOR_TOKENS_TABLE");
  return value;
}

export function normalizeSegment(raw: string | undefined): string | undefined {
  const value = raw?.trim().toLowerCase().replace(/_/g, "-");
  return value ? value : undefined;
}

export function connectorKey(provider: string, accountId: string): string {
  return `${provider}/${accountId}`;
}

export function pathProviderAndAccount(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): { provider?: string; accountId?: string } {
  return {
    provider: normalizeSegment(decodeURIComponent(event.pathParameters?.provider ?? "")),
    accountId: normalizeSegment(decodeURIComponent(event.pathParameters?.accountId ?? "")),
  };
}

export function summarize(item: ConnectorTokenItem) {
  return {
    provider: item.provider,
    accountId: item.accountId,
    displayName: item.displayName,
    scopes: item.scopes ?? [],
    expiresAt: item.expiresAt,
    updatedAt: item.updatedAt,
    hasAccessToken: Boolean(item.accessToken),
    hasRefreshToken: Boolean(item.refreshToken),
  };
}

export function parseJsonBody(event: APIGatewayProxyEventV2WithJWTAuthorizer): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(raw);
}
