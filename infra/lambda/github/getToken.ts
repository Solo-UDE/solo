import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, env, json } from "./shared.js";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const claims = event.requestContext.authorizer.jwt.claims;
  const userId = claims.sub as string | undefined;
  if (!userId) return json(401, { error: "missing_sub" });

  const { Item } = await ddb.send(
    new GetCommand({ TableName: env("TOKENS_TABLE"), Key: { userId } }),
  );
  if (!Item) return json(404, { error: "not_linked" });

  return json(
    200,
    {
      access_token: Item.access_token,
      github_login: Item.github_login,
      github_user_id: Item.github_user_id,
      granted_scopes: Item.granted_scopes,
      linked_at: Item.linked_at,
      source: Item.source,
    },
    { "cache-control": "no-store" },
  );
};
