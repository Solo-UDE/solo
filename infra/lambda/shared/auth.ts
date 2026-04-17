import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

export interface AuthedUser {
  readonly userId: string;
  readonly email?: string;
  readonly username?: string;
}

export function extractUser(event: APIGatewayProxyEventV2WithJWTAuthorizer): AuthedUser {
  const claims = event.requestContext.authorizer.jwt.claims;
  const userId = claims.sub as string | undefined;
  if (!userId) {
    throw new Error("Missing sub claim on JWT");
  }
  return {
    userId,
    email: claims.email as string | undefined,
    username: claims["cognito:username"] as string | undefined,
  };
}

export function json(status: number, body: unknown): {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
} {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}
