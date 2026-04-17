import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, env } from "../shared/ddb.js";
import { extractUser, json } from "../shared/auth.js";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const user = extractUser(event);
  const statsTable = env("STATS_TABLE");
  const dailyTable = env("DAILY_ACTIVITY_TABLE");

  const { Item } = await ddb.send(
    new GetCommand({ TableName: statsTable, Key: { userId: user.userId } }),
  );

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 26 * 7);
  const sinceStr = since.toISOString().slice(0, 10);

  const daily = await ddb.send(
    new QueryCommand({
      TableName: dailyTable,
      KeyConditionExpression: "userId = :u AND #d >= :s",
      ExpressionAttributeNames: { "#d": "date" },
      ExpressionAttributeValues: { ":u": user.userId, ":s": sinceStr },
    }),
  );

  return json(200, {
    stats: Item ?? {
      userId: user.userId,
      commits: 0,
      tokens: 0,
      worktrees: 0,
      sessions: 0,
      messages: 0,
      tier: 1,
      tier_progress: 0,
      score: 0,
    },
    heatmap: daily.Items ?? [],
  });
};
