import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { env, getGitHubOauthCreds, json, signState } from "./shared.js";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const REQUESTED_SCOPES = "read:user user:email repo workflow";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const claims = event.requestContext.authorizer.jwt.claims;
  const userId = claims.sub as string | undefined;
  if (!userId) return json(401, { error: "missing_sub" });

  const { clientId } = await getGitHubOauthCreds();
  const callbackUrl = env("LINK_CALLBACK_URL");

  const state = await signState({ userId, kind: "link" });

  const u = new URL(GITHUB_AUTHORIZE_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", callbackUrl);
  u.searchParams.set("scope", REQUESTED_SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("allow_signup", "false");
  return json(200, { authorizeUrl: u.toString() });
};
