import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, env } from "../shared/ddb.js";
import { json } from "../shared/auth.js";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const limit = Math.min(parseInt(event.queryStringParameters?.limit ?? "100", 10) || 100, 500);
  const { Items = [] } = await ddb.send(
    new QueryCommand({
      TableName: env("STATS_TABLE"),
      IndexName: "leaderboard-index",
      KeyConditionExpression: "global_partition = :g",
      ExpressionAttributeValues: { ":g": "GLOBAL" },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  const entries = Items.map(projectRow);
  return json(200, { entries, leaderboard: entries, count: entries.length });
};

function projectRow(item: Record<string, unknown>) {
  const githubUsername = item.githubUsername ?? item.github_username ?? null;
  return {
    userId: item.userId,
    tier: item.tier,
    score: item.score,
    commits: item.commits ?? 0,
    tokens: item.tokens ?? 0,
    worktrees: item.worktrees ?? 0,
    githubUsername,
    github_username: githubUsername,
  };
}
