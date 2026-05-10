import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../shared/ddb.js";
import { extractUserId, json, summarize, tableName, type ConnectorTokenItem } from "./shared.js";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const userId = extractUserId(event);
  if (!userId) return json(401, { error: "missing_sub" });

  const { Items } = await ddb.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: { ":userId": userId },
    }),
  );

  const items = (Items ?? []) as ConnectorTokenItem[];
  const accounts = items
    .map(summarize)
    .sort((a, b) => `${a.provider}/${a.accountId}`.localeCompare(`${b.provider}/${b.accountId}`));

  return json(200, { accounts }, { "cache-control": "no-store" });
};
