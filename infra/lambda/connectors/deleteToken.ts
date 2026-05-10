import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../shared/ddb.js";
import { connectorKey, extractUserId, json, pathProviderAndAccount, tableName } from "./shared.js";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const userId = extractUserId(event);
  if (!userId) return json(401, { error: "missing_sub" });

  const { provider, accountId } = pathProviderAndAccount(event);
  if (!provider || !accountId) return json(400, { error: "invalid_connector_key" });

  await ddb.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { userId, connectorKey: connectorKey(provider, accountId) },
    }),
  );
  return json(200, { deleted: true });
};
