import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../shared/ddb.js";
import {
  connectorKey,
  extractUserId,
  json,
  pathProviderAndAccount,
  tableName,
  type ConnectorTokenItem,
} from "./shared.js";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const userId = extractUserId(event);
  if (!userId) return json(401, { error: "missing_sub" });

  const { provider, accountId } = pathProviderAndAccount(event);
  if (!provider || !accountId) return json(400, { error: "invalid_connector_key" });

  const { Item } = await ddb.send(
    new GetCommand({
      TableName: tableName(),
      Key: { userId, connectorKey: connectorKey(provider, accountId) },
    }),
  );
  if (!Item) return json(404, { error: "not_connected" });

  const item = Item as ConnectorTokenItem;
  return json(
    200,
    {
      provider: item.provider,
      accountId: item.accountId,
      displayName: item.displayName,
      accessToken: item.accessToken,
      refreshToken: item.refreshToken,
      scopes: item.scopes ?? [],
      expiresAt: item.expiresAt,
      updatedAt: item.updatedAt,
    },
    { "cache-control": "no-store" },
  );
};
