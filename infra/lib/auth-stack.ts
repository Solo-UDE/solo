import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "node:path";
import * as url from "node:url";
import type { SoloStageConfig } from "./config.js";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SoloAuthStackProps extends cdk.StackProps {
  readonly config: SoloStageConfig;
  readonly githubOidcIssuerUrl?: string;
  readonly githubTokensTableName?: string;
  readonly githubPendingTableName?: string;
}

export class SoloAuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;
  public readonly identityPool: cognito.CfnIdentityPool;
  public readonly authenticatedRole: iam.Role;

  constructor(scope: Construct, id: string, props: SoloAuthStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `solo-users-${config.stage}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: false },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      customAttributes: {
        tier: new cognito.NumberAttribute({ min: 1, max: 7, mutable: true }),
        tier_progress: new cognito.NumberAttribute({ min: 0, max: 100, mutable: true }),
        github_username: new cognito.StringAttribute({ minLen: 0, maxLen: 256, mutable: true }),
      },
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      removalPolicy: config.removalPolicy,
    });

    this.userPoolDomain = this.userPool.addDomain("HostedDomain", {
      cognitoDomain: { domainPrefix: config.cognitoDomainPrefix },
    });

    const supportedIdps: cognito.UserPoolClientIdentityProvider[] = [
      cognito.UserPoolClientIdentityProvider.COGNITO,
    ];
    let googleIdp: cognito.UserPoolIdentityProviderGoogle | undefined;

    if (config.googleOidcEnabled) {
      const googleSecret = new secretsmanager.Secret(this, "GoogleOidcSecret", {
        secretName: `solo/${config.stage}/google-oidc-client`,
        description: "Google OAuth client ID and secret for Cognito federation",
        secretObjectValue: {
          clientId: cdk.SecretValue.unsafePlainText("REPLACE_ME_AFTER_DEPLOY"),
          clientSecret: cdk.SecretValue.unsafePlainText("REPLACE_ME_AFTER_DEPLOY"),
        },
        removalPolicy: config.removalPolicy,
      });

      googleIdp = new cognito.UserPoolIdentityProviderGoogle(this, "GoogleIdp", {
        userPool: this.userPool,
        clientId: googleSecret.secretValueFromJson("clientId").unsafeUnwrap(),
        clientSecretValue: googleSecret.secretValueFromJson("clientSecret"),
        scopes: ["openid", "email", "profile"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      });

      supportedIdps.push(cognito.UserPoolClientIdentityProvider.GOOGLE);
    }

    let githubIdp: cognito.UserPoolIdentityProviderOidc | undefined;
    if (config.githubOidcEnabled) {
      new secretsmanager.Secret(this, "GitHubOidcSecret", {
        secretName: `solo/${config.stage}/github-oidc-client`,
        description: "GitHub OAuth app client ID and secret (used by OIDC wrapper Lambda)",
        secretObjectValue: {
          clientId: cdk.SecretValue.unsafePlainText("REPLACE_ME_AFTER_DEPLOY"),
          clientSecret: cdk.SecretValue.unsafePlainText("REPLACE_ME_AFTER_DEPLOY"),
        },
        removalPolicy: config.removalPolicy,
      });

      if (props.githubOidcIssuerUrl) {
        githubIdp = new cognito.UserPoolIdentityProviderOidc(this, "GitHubIdp", {
          name: "GitHub",
          userPool: this.userPool,
          clientId: "solo-desktop",
          clientSecret: "unused",
          issuerUrl: props.githubOidcIssuerUrl,
          scopes: ["openid", "email", "profile"],
          attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
          attributeMapping: {
            email: cognito.ProviderAttribute.other("email"),
            preferredUsername: cognito.ProviderAttribute.other("preferred_username"),
            profilePicture: cognito.ProviderAttribute.other("picture"),
            fullname: cognito.ProviderAttribute.other("name"),
          },
        });

        supportedIdps.push(cognito.UserPoolClientIdentityProvider.custom("GitHub"));
      }
    }

    this.userPoolClient = this.userPool.addClient("DesktopClient", {
      userPoolClientName: `solo-desktop-${config.stage}`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: false,
        adminUserPassword: false,
        custom: false,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
        callbackUrls: [
          "soloide://auth/callback",
          "http://localhost:3000/auth/callback",
          "https://solo.dev/auth/callback",
          "http://localhost:3000/api/auth/callback/cognito",
          "https://solo.dev/api/auth/callback/cognito",
        ],
        logoutUrls: [
          "soloide://auth/signout",
          "http://localhost:3000",
          "https://solo.dev",
        ],
      },
      supportedIdentityProviders: supportedIdps,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    if (googleIdp) {
      this.userPoolClient.node.addDependency(googleIdp);
    }
    if (githubIdp) {
      this.userPoolClient.node.addDependency(githubIdp);
    }

    if (props.githubTokensTableName && props.githubPendingTableName) {
      const postAuthFnName = `solo-gh-postAuth-${config.stage}`;
      const postAuthLogGroup = new logs.LogGroup(this, "PostAuthLogGroup", {
        logGroupName: `/aws/lambda/${postAuthFnName}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: config.removalPolicy,
      });
      const postAuthFn = new lambdaNodejs.NodejsFunction(this, "PostAuthFn", {
        functionName: postAuthFnName,
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        entry: path.resolve(__dirname, "..", "lambda/github/postAuth.ts"),
        handler: "handler",
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        logGroup: postAuthLogGroup,
        environment: {
          STAGE: config.stage,
          TOKENS_TABLE: props.githubTokensTableName,
          PENDING_TABLE: props.githubPendingTableName,
          AWS_REGION_OVERRIDE: config.region,
          GITHUB_SECRET_ARN: "unused-in-postauth",
          STATE_SIGNING_SECRET_ARN: "unused-in-postauth",
          JWT_SIGNING_KEY_ID: "unused-in-postauth",
          OIDC_ISSUER: "unused-in-postauth",
        },
        bundling: {
          minify: true,
          sourceMap: true,
          target: "node20",
          externalModules: ["@aws-sdk/*"],
        },
      });

      const tokensTableArn = `arn:aws:dynamodb:${config.region}:${this.account}:table/${props.githubTokensTableName}`;
      const pendingTableArn = `arn:aws:dynamodb:${config.region}:${this.account}:table/${props.githubPendingTableName}`;
      postAuthFn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:DeleteItem",
            "dynamodb:UpdateItem",
          ],
          resources: [tokensTableArn, pendingTableArn],
        }),
      );
      postAuthFn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey*", "kms:DescribeKey"],
          resources: ["*"],
          conditions: {
            StringEquals: {
              "kms:ViaService": `dynamodb.${config.region}.amazonaws.com`,
            },
          },
        }),
      );

      this.userPool.addTrigger(cognito.UserPoolOperation.POST_AUTHENTICATION, postAuthFn);
    }

    this.identityPool = new cognito.CfnIdentityPool(this, "IdentityPool", {
      identityPoolName: `solo_users_${config.stage}`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
          serverSideTokenCheck: true,
        },
      ],
    });

    this.authenticatedRole = new iam.Role(this, "AuthenticatedRole", {
      roleName: `solo-authenticated-${config.stage}`,
      description: "Granted to authenticated Cognito users via the Identity Pool",
      assumedBy: new iam.FederatedPrincipal(
        "cognito-identity.amazonaws.com",
        {
          StringEquals: {
            "cognito-identity.amazonaws.com:aud": this.identityPool.ref,
          },
          "ForAnyValue:StringLike": {
            "cognito-identity.amazonaws.com:amr": "authenticated",
          },
        },
        "sts:AssumeRoleWithWebIdentity",
      ),
    });

    new cognito.CfnIdentityPoolRoleAttachment(this, "IdentityPoolRoles", {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: this.authenticatedRole.roleArn,
      },
    });

    new cdk.CfnOutput(this, "UserPoolId", {
      value: this.userPool.userPoolId,
      exportName: `solo-${config.stage}-user-pool-id`,
    });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      exportName: `solo-${config.stage}-user-pool-client-id`,
    });
    new cdk.CfnOutput(this, "CognitoDomain", {
      value: `${this.userPoolDomain.domainName}.auth.${config.region}.amazoncognito.com`,
      exportName: `solo-${config.stage}-cognito-domain`,
    });
    new cdk.CfnOutput(this, "IdentityPoolId", {
      value: this.identityPool.ref,
      exportName: `solo-${config.stage}-identity-pool-id`,
    });
    new cdk.CfnOutput(this, "AuthenticatedRoleArn", {
      value: this.authenticatedRole.roleArn,
      exportName: `solo-${config.stage}-authenticated-role-arn`,
    });
  }
}
