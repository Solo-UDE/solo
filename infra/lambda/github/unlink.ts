import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, env, json } from "./shared.js";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const claims = event.requestContext.authorizer.jwt.claims;
  const userId = claims.sub as string | undefined;
  if (!userId) return json(401, { error: "missing_sub" });

  await ddb.send(
    new DeleteCommand({ TableName: env("TOKENS_TABLE"), Key: { userId } }),
  );
  return json(200, { unlinked: true });
};
