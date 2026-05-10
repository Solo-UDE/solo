import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, env } from "../shared/ddb.js";
import { json } from "../shared/auth.js";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const tierParam = event.pathParameters?.tier;
  const tier = parseInt(tierParam ?? "1", 10);
  if (isNaN(tier) || tier < 1 || tier > 7) {
    return json(400, { error: "tier must be 1-7" });
  }
  const limit = Math.min(parseInt(event.queryStringParameters?.limit ?? "100", 10) || 100, 500);
  const { Items = [] } = await ddb.send(
    new QueryCommand({
      TableName: env("STATS_TABLE"),
      IndexName: "tier-leaderboard-index",
      KeyConditionExpression: "tier = :t",
      ExpressionAttributeValues: { ":t": tier },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  const entries = Items.map(projectRow);
  return json(200, { tier, entries, leaderboard: entries, count: entries.length });
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
