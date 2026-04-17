import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwInt from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
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

export interface SoloGitHubStackProps extends cdk.StackProps {
  readonly config: SoloStageConfig;
}

export class SoloGitHubStack extends cdk.Stack {
  public readonly tokensTable: dynamodb.Table;
  public readonly pendingTable: dynamodb.Table;
  public readonly tokenEncryptionKey: kms.Key;
  public readonly jwtSigningKey: kms.Key;
  public readonly oidcApi: apigw.HttpApi;
  public readonly linkStartLambda: lambdaNodejs.NodejsFunction;
  public readonly getTokenLambda: lambdaNodejs.NodejsFunction;
  public readonly unlinkLambda: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: SoloGitHubStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.tokenEncryptionKey = new kms.Key(this, "TokenEncryptionKey", {
      alias: `alias/solo-github-tokens-${config.stage}`,
      description: "Encrypts GitHub access tokens at rest in DynamoDB",
      enableKeyRotation: true,
      removalPolicy: config.removalPolicy,
    });

    this.jwtSigningKey = new kms.Key(this, "JwtSigningKey", {
      alias: `alias/solo-github-oidc-jwt-${config.stage}`,
      description: "RSA key for signing JWTs in the GitHub OIDC wrapper",
      keySpec: kms.KeySpec.RSA_2048,
      keyUsage: kms.KeyUsage.SIGN_VERIFY,
      removalPolicy: config.removalPolicy,
    });

    this.tokensTable = new dynamodb.Table(this, "TokensTable", {
      tableName: `solo-github-tokens-${config.stage}`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.tokenEncryptionKey,
      removalPolicy: config.removalPolicy,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.pointInTimeRecovery,
      },
    });
    this.tokensTable.addGlobalSecondaryIndex({
      indexName: "by-github-user-id",
      partitionKey: { name: "github_user_id", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    this.pendingTable = new dynamodb.Table(this, "PendingTable", {
      tableName: `solo-github-pending-${config.stage}`,
      partitionKey: { name: "github_user_id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.tokenEncryptionKey,
      timeToLiveAttribute: "ttl",
      removalPolicy: config.removalPolicy,
    });

    const githubSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GitHubSecret",
      `solo/${config.stage}/github-oidc-client`,
    );

    const stateSigningSecret = new secretsmanager.Secret(this, "StateSigningSecret", {
      secretName: `solo/${config.stage}/github-state-signing`,
      description: "HMAC secret for signing OAuth state tokens (CSRF protection)",
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: config.removalPolicy,
    });

    const oidcIssuerPlaceholder = `https://OIDC_ISSUER_PENDING_SYNTH.invalid`;

    const makeLambda = (
      name: string,
      entryPath: string,
      opts: Partial<lambdaNodejs.NodejsFunctionProps> = {},
    ): lambdaNodejs.NodejsFunction => {
      const functionName = `solo-gh-${name}-${config.stage}`;
      const logGroup = new logs.LogGroup(this, `${name}LogGroup`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: config.removalPolicy,
      });
      return new lambdaNodejs.NodejsFunction(this, name, {
        functionName,
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        entry: path.resolve(__dirname, "..", entryPath),
        handler: "handler",
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        logGroup,
        environment: {
          STAGE: config.stage,
          TOKENS_TABLE: this.tokensTable.tableName,
          PENDING_TABLE: this.pendingTable.tableName,
          JWT_SIGNING_KEY_ID: this.jwtSigningKey.keyId,
          // Pass the *name*, not the partial ARN. `fromSecretNameV2` emits a
          // suffix-less ARN; IAM `GetSecretValue` on that literal string
          // doesn't match the `-??????` wildcard grantRead produces. Using
          // the name forces AWS to resolve to the full ARN with suffix
          // before IAM evaluates, so the wildcard matches.
          GITHUB_SECRET_NAME: githubSecret.secretName,
          STATE_SIGNING_SECRET_ARN: stateSigningSecret.secretArn,
          AWS_REGION_OVERRIDE: config.region,
          OIDC_ISSUER: oidcIssuerPlaceholder,
        },
        bundling: {
          minify: true,
          sourceMap: true,
          target: "node20",
          externalModules: ["@aws-sdk/*"],
        },
        ...opts,
      });
    };

    const oidcHandler = makeLambda("oidcWrapper", "lambda/github/oidcHandler.ts", {
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
    });

    this.linkStartLambda = makeLambda("linkStart", "lambda/github/linkStart.ts");
    this.getTokenLambda = makeLambda("getToken", "lambda/github/getToken.ts");
    this.unlinkLambda = makeLambda("unlink", "lambda/github/unlink.ts");

    const grants = [
      oidcHandler,
      this.linkStartLambda,
      this.getTokenLambda,
      this.unlinkLambda,
    ];
    grants.forEach((fn) => {
      this.tokensTable.grantReadWriteData(fn);
      this.pendingTable.grantReadWriteData(fn);
      githubSecret.grantRead(fn);
      stateSigningSecret.grantRead(fn);
    });

    this.jwtSigningKey.grantEncryptDecrypt(oidcHandler);
    oidcHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["kms:Sign", "kms:GetPublicKey"],
        resources: [this.jwtSigningKey.keyArn],
      }),
    );

    this.oidcApi = new apigw.HttpApi(this, "OidcApi", {
      apiName: `solo-github-oidc-${config.stage}`,
      description: `GitHub OIDC wrapper for Cognito — ${config.stage}`,
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["content-type", "authorization"],
      },
    });

    const addRoute = (method: apigw.HttpMethod, route: string, fn: lambda.IFunction) => {
      this.oidcApi.addRoutes({
        path: route,
        methods: [method],
        integration: new apigwInt.HttpLambdaIntegration(
          `oidc-${method}-${route.replace(/[/.]/g, "_")}`,
          fn,
        ),
      });
    };

    addRoute(apigw.HttpMethod.GET, "/.well-known/openid-configuration", oidcHandler);
    addRoute(apigw.HttpMethod.GET, "/.well-known/jwks.json", oidcHandler);
    addRoute(apigw.HttpMethod.GET, "/authorize", oidcHandler);
    addRoute(apigw.HttpMethod.GET, "/callback", oidcHandler);
    addRoute(apigw.HttpMethod.POST, "/token", oidcHandler);
    addRoute(apigw.HttpMethod.GET, "/userinfo", oidcHandler);

    oidcHandler.addEnvironment("OIDC_ISSUER", this.oidcApi.apiEndpoint);
    this.linkStartLambda.addEnvironment("OIDC_ISSUER", this.oidcApi.apiEndpoint);
    this.linkStartLambda.addEnvironment("LINK_CALLBACK_URL", `${this.oidcApi.apiEndpoint}/callback`);

    new cdk.CfnOutput(this, "OidcApiUrl", {
      value: this.oidcApi.apiEndpoint,
      exportName: `solo-${config.stage}-github-oidc-api`,
    });
    new cdk.CfnOutput(this, "OidcIssuer", {
      value: this.oidcApi.apiEndpoint,
      exportName: `solo-${config.stage}-github-oidc-issuer`,
    });
    new cdk.CfnOutput(this, "TokensTableName", {
      value: this.tokensTable.tableName,
      exportName: `solo-${config.stage}-github-tokens-table`,
    });
    new cdk.CfnOutput(this, "GitHubCallbackUrl", {
      value: `${this.oidcApi.apiEndpoint}/callback`,
      description: "Register this as the single Authorization callback URL in GitHub OAuth app",
      exportName: `solo-${config.stage}-github-callback-url`,
    });
  }

}
