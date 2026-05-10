import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand, UpdateCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, env } from "../shared/ddb.js";
import { extractUser, json } from "../shared/auth.js";
import { computeTier } from "../shared/tier.js";

interface StatsDelta {
  commits?: number;
  tokens?: number;
  worktrees?: number;
  sessions?: number;
  messages?: number;
}

interface SyncBody {
  delta: StatsDelta;
  daily: Record<string, StatsDelta>;
  githubUsername?: string;
  lastActive?: string;
}

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const user = extractUser(event);
  const body = parseBody(event.body);
  const githubUsername = displayNameForStats(event, body, user.email);
  const statsTable = env("STATS_TABLE");
  const dailyTable = env("DAILY_ACTIVITY_TABLE");

  const { Attributes: updated } = await ddb.send(
    new UpdateCommand({
      TableName: statsTable,
      Key: { userId: user.userId },
      UpdateExpression: buildUpdateExpression(body, githubUsername),
      ExpressionAttributeNames: buildExpressionAttributeNames(body),
      ExpressionAttributeValues: buildExpressionAttributeValues(body, user.email, githubUsername),
      ReturnValues: "ALL_NEW",
    }),
  );

  const commits = (updated?.commits as number) ?? 0;
  const tokens = (updated?.tokens as number) ?? 0;
  const worktrees = (updated?.worktrees as number) ?? 0;
  const { tier, tierProgress, score } = computeTier(commits, tokens, worktrees);

  await ddb.send(
    new UpdateCommand({
      TableName: statsTable,
      Key: { userId: user.userId },
      UpdateExpression: "SET tier = :t, tier_progress = :tp, score = :s, global_partition = :g",
      ExpressionAttributeValues: {
        ":t": tier,
        ":tp": Math.round(tierProgress * 100),
        ":s": score,
        ":g": "GLOBAL",
      },
    }),
  );

  if (body.daily && Object.keys(body.daily).length > 0) {
    await writeDailyActivity(user.userId, body.daily, dailyTable);
  }

  return json(200, { tier, tier_progress: Math.round(tierProgress * 100), score });
};

function parseBody(raw: string | undefined): SyncBody {
  if (!raw) return { delta: {}, daily: {} };
  try {
    return JSON.parse(raw) as SyncBody;
  } catch {
    return { delta: {}, daily: {} };
  }
}

function buildUpdateExpression(body: SyncBody, githubUsername: string | undefined): string {
  const addParts: string[] = [];
  if (body.delta?.commits) addParts.push("commits :c");
  if (body.delta?.tokens) addParts.push("tokens :tk");
  if (body.delta?.worktrees) addParts.push("worktrees :w");
  if (body.delta?.sessions) addParts.push("sessions :ss");
  if (body.delta?.messages) addParts.push("messages :m");
  const setParts: string[] = [];
  if (githubUsername) setParts.push("github_username = :gu");
  if (body.lastActive) setParts.push("last_active = :la");
  setParts.push("#e = if_not_exists(#e, :e)");
  let expr = "";
  if (addParts.length > 0) expr += "ADD " + addParts.join(", ");
  if (setParts.length > 0) expr += (expr ? " " : "") + "SET " + setParts.join(", ");
  return expr;
}

function buildExpressionAttributeNames(_body: SyncBody): Record<string, string> {
  return { "#e": "email" };
}

function buildExpressionAttributeValues(
  body: SyncBody,
  email: string | undefined,
  githubUsername: string | undefined,
): Record<string, unknown> {
  const v: Record<string, unknown> = { ":e": email ?? "" };
  if (body.delta?.commits) v[":c"] = body.delta.commits;
  if (body.delta?.tokens) v[":tk"] = body.delta.tokens;
  if (body.delta?.worktrees) v[":w"] = body.delta.worktrees;
  if (body.delta?.sessions) v[":ss"] = body.delta.sessions;
  if (body.delta?.messages) v[":m"] = body.delta.messages;
  if (githubUsername) v[":gu"] = githubUsername;
  if (body.lastActive) v[":la"] = body.lastActive;
  return v;
}

function displayNameForStats(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  body: SyncBody,
  email: string | undefined,
): string | undefined {
  const claims = event.requestContext.authorizer.jwt.claims;
  const raw =
    body.githubUsername ??
    stringClaim(claims["custom:github_username"]) ??
    stringClaim(claims.preferred_username) ??
    email?.split("@")[0] ??
    stringClaim(claims["cognito:username"]);
  return normalizeDisplayName(raw);
}

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return withoutAt.slice(0, 256);
}

async function writeDailyActivity(
  userId: string,
  daily: Record<string, StatsDelta>,
  tableName: string,
): Promise<void> {
  const entries = Object.entries(daily);
  const ttl = Math.floor(Date.now() / 1000) + 400 * 86400;
  for (let i = 0; i < entries.length; i += 25) {
    const chunk = entries.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: chunk.map(([date, delta]) => ({
            PutRequest: {
              Item: { userId, date, ttl, ...delta },
            },
          })),
        },
      }),
    );
  }
}
