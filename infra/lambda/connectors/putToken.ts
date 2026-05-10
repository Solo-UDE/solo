import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../shared/ddb.js";
import {
  connectorKey,
  extractUserId,
  json,
  parseJsonBody,
  pathProviderAndAccount,
  summarize,
  tableName,
  type ConnectorTokenItem,
} from "./shared.js";

interface PutTokenBody {
  readonly displayName?: unknown;
  readonly accessToken?: unknown;
  readonly refreshToken?: unknown;
  readonly scopes?: unknown;
  readonly expiresAt?: unknown;
}

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const userId = extractUserId(event);
  if (!userId) return json(401, { error: "missing_sub" });

  const { provider, accountId } = pathProviderAndAccount(event);
  if (!provider || !accountId) return json(400, { error: "invalid_connector_key" });

  let body: PutTokenBody;
  try {
    body = parseJsonBody(event) as PutTokenBody;
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const accessToken =
    typeof body.accessToken === "string" && body.accessToken.trim()
      ? body.accessToken.trim()
      : undefined;
  const refreshToken =
    typeof body.refreshToken === "string" && body.refreshToken.trim()
      ? body.refreshToken.trim()
      : undefined;
  if (!accessToken && !refreshToken) {
    return json(400, { error: "missing_token" });
  }

  const key = connectorKey(provider, accountId);
  const { Item } = await ddb.send(
    new GetCommand({ TableName: tableName(), Key: { userId, connectorKey: key } }),
  );
  const existing = Item as ConnectorTokenItem | undefined;
  const now = new Date().toISOString();
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter(
        (scope): scope is string => typeof scope === "string" && scope.trim().length > 0,
      )
    : existing?.scopes ?? [];

  const item: ConnectorTokenItem = {
    userId,
    connectorKey: key,
    provider,
    accountId,
    displayName:
      typeof body.displayName === "string" && body.displayName.trim()
        ? body.displayName.trim()
        : existing?.displayName,
    accessToken: accessToken ?? existing?.accessToken,
    refreshToken: refreshToken ?? existing?.refreshToken,
    scopes,
    expiresAt:
      typeof body.expiresAt === "string" && body.expiresAt.trim()
        ? body.expiresAt.trim()
        : existing?.expiresAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: tableName(), Item: item }));

  return json(200, { account: summarize(item) }, { "cache-control": "no-store" });
};
