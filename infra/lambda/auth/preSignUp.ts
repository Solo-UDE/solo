import type { PreSignUpTriggerEvent, PreSignUpTriggerHandler } from "aws-lambda";
import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const region = process.env.AWS_REGION_OVERRIDE ?? process.env.AWS_REGION ?? "us-east-1";
const cognito = new CognitoIdentityProviderClient({ region });

// Cognito does not auto-link federated identities across IdPs. Without this
// trigger, a user who first signs in with GitHub and later tries Google (same
// email) hits `user.email: Attribute already exists` because the email is a
// UsernameAttribute and therefore globally unique in the pool.
//
// This trigger fires BEFORE Cognito provisions a new federated user. If an
// existing user with the same email is found, we call AdminLinkProviderForUser
// to attach the incoming identity to the existing user and mark the event
// auto-confirmed / auto-verified. Cognito then completes the sign-in flow
// against the merged user instead of creating a duplicate.
export const handler: PreSignUpTriggerHandler = async (event: PreSignUpTriggerEvent) => {
  if (event.triggerSource !== "PreSignUp_ExternalProvider") {
    return event;
  }

  const email = event.request.userAttributes.email?.toLowerCase().trim();
  if (!email) {
    console.warn("[preSignUp] no email attribute on incoming federated user; skipping link");
    return event;
  }

  // event.userName is the federated identity in the form `<Provider>_<ProviderSubject>`,
  // e.g. "Google_102115548731312302335" or "GitHub_github:87144268". Split on the
  // first underscore so GitHub's colon-containing subject survives.
  const firstUnderscore = event.userName.indexOf("_");
  if (firstUnderscore <= 0) {
    console.warn(`[preSignUp] unexpected userName shape: ${event.userName}`);
    return event;
  }
  const providerName = event.userName.slice(0, firstUnderscore);
  const providerUserId = event.userName.slice(firstUnderscore + 1);

  const existing = await cognito.send(
    new ListUsersCommand({
      UserPoolId: event.userPoolId,
      Filter: `email = "${email}"`,
      Limit: 2,
    }),
  );
  const candidates = existing.Users ?? [];

  if (candidates.length === 0) {
    // First time we've seen this email. Let Cognito create the new user
    // normally — auto-confirm so the user lands authenticated on return.
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
    return event;
  }

  if (candidates.length > 1) {
    // Bail out rather than link to an ambiguous destination. Cognito will
    // surface the original duplicate-email error to the client.
    console.error(
      `[preSignUp] multiple users already share email ${email}; refusing to link`,
    );
    return event;
  }

  const destination = candidates[0];
  if (!destination.Username) {
    console.error(`[preSignUp] destination user for ${email} missing Username`);
    return event;
  }

  try {
    await cognito.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: event.userPoolId,
        DestinationUser: {
          ProviderName: "Cognito",
          ProviderAttributeValue: destination.Username,
        },
        SourceUser: {
          ProviderName: providerName,
          ProviderAttributeName: "Cognito_Subject",
          ProviderAttributeValue: providerUserId,
        },
      }),
    );
    console.log(
      `[preSignUp] linked ${providerName}:${providerUserId} → ${destination.Username} (email=${email})`,
    );
  } catch (err) {
    console.error(`[preSignUp] AdminLinkProviderForUser failed for ${email}:`, err);
    // Re-throw so Cognito aborts the sign-up rather than silently creating a
    // duplicate user. The user will see the original OAuthCallbackError, but
    // CloudWatch has the precise cause.
    throw err;
  }

  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};
