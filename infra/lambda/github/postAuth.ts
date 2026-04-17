import type { PostAuthenticationTriggerEvent, PostAuthenticationTriggerHandler } from "aws-lambda";
import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, env } from "./shared.js";

export const handler: PostAuthenticationTriggerHandler = async (event: PostAuthenticationTriggerEvent) => {
  try {
    const identities = event.request.userAttributes.identities;
    if (!identities) return event;
    const parsed = typeof identities === "string" ? JSON.parse(identities) : identities;
    if (!Array.isArray(parsed)) return event;

    const githubIdentity = parsed.find(
      (i: { providerName?: string }) => i.providerName === "GitHub",
    ) as { userId?: string; providerName?: string } | undefined;
    if (!githubIdentity?.userId) return event;

    const cognitoSub = event.request.userAttributes.sub;
    if (!cognitoSub) return event;

    const githubUserId = `github:${githubIdentity.userId}`;
    const { Item } = await ddb.send(
      new GetCommand({ TableName: env("PENDING_TABLE"), Key: { github_user_id: githubUserId } }),
    );
    if (!Item?.access_token) {
      console.log(`no pending token for ${githubUserId}`);
      return event;
    }

    await ddb.send(
      new PutCommand({
        TableName: env("TOKENS_TABLE"),
        Item: {
          userId: cognitoSub,
          access_token: Item.access_token,
          github_login: Item.github_login,
          github_user_id: githubUserId,
          github_numeric_id: Item.github_numeric_id,
          granted_scopes: Item.granted_scopes,
          linked_at: new Date().toISOString(),
          source: "signin",
        },
      }),
    );

    await ddb.send(
      new DeleteCommand({
        TableName: env("PENDING_TABLE"),
        Key: { github_user_id: githubUserId },
      }),
    );
    console.log(`linked GitHub ${githubUserId} → Cognito ${cognitoSub}`);
  } catch (err) {
    console.error("postAuth trigger error:", err);
  }
  return event;
};
