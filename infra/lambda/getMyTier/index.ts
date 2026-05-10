import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, env } from "../shared/ddb.js";
import { extractUser, json } from "../shared/auth.js";
import { computeTier, TIER_NAMES } from "../shared/tier.js";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const user = extractUser(event);
  const { Item } = await ddb.send(
    new GetCommand({ TableName: env("STATS_TABLE"), Key: { userId: user.userId } }),
  );

  const commits = (Item?.commits as number) ?? 0;
  const tokens = (Item?.tokens as number) ?? 0;
  const worktrees = (Item?.worktrees as number) ?? 0;
  const { tier, tierProgress, score } = computeTier(commits, tokens, worktrees);

  return json(200, {
    tier,
    tierName: TIER_NAMES[tier],
    tier_name: TIER_NAMES[tier],
    tierProgress: Math.round(tierProgress * 100),
    tier_progress: Math.round(tierProgress * 100),
    score,
    names: [],
    totals: { commits, tokens, worktrees },
  });
};
