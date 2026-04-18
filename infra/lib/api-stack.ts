import * as cdk from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwAuth from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as apigwInt from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { existsSync } from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
import type { SoloStageConfig } from "./config.js";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveEntryPath(entryPath: string): string {
  const abs = path.resolve(__dirname, "..", entryPath);
  if (existsSync(abs)) return abs;
  if (entryPath.endsWith(".ts")) {
    const compiled = abs.replace(/\.ts$/, ".js");
    if (existsSync(compiled)) return compiled;
  }
  return abs;
}

export interface SoloApiStackProps extends cdk.StackProps {
  readonly config: SoloStageConfig;
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly statsTable: dynamodb.Table;
  readonly dailyActivityTable: dynamodb.Table;
  readonly shareCardsTable: dynamodb.Table;
  readonly shareCardsBucket: s3.Bucket;
  readonly githubLinkStartFn?: lambda.IFunction;
  readonly githubGetTokenFn?: lambda.IFunction;
  readonly githubUnlinkFn?: lambda.IFunction;
}

export class SoloApiStack extends cdk.Stack {
  public readonly httpApi: apigw.HttpApi;

  constructor(scope: Construct, id: string, props: SoloApiStackProps) {
    super(scope, id, props);
    const {
      config,
      userPool,
      userPoolClient,
      statsTable,
      dailyActivityTable,
      shareCardsTable,
      shareCardsBucket,
    } = props;

    this.httpApi = new apigw.HttpApi(this, "HttpApi", {
      apiName: `solo-api-${config.stage}`,
      description: `Solo IDE HTTP API (${config.stage})`,
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ["authorization", "content-type"],
        maxAge: cdk.Duration.minutes(10),
      },
      defaultAuthorizer: new apigwAuth.HttpJwtAuthorizer(
        "CognitoAuthorizer",
        `https://cognito-idp.${config.region}.amazonaws.com/${userPool.userPoolId}`,
        {
          jwtAudience: [userPoolClient.userPoolClientId],
          identitySource: ["$request.header.Authorization"],
        },
      ),
    });

    const sharedEnv = {
      STAGE: config.stage,
      STATS_TABLE: statsTable.tableName,
      DAILY_ACTIVITY_TABLE: dailyActivityTable.tableName,
      SHARE_CARDS_TABLE: shareCardsTable.tableName,
      SHARE_CARDS_BUCKET: shareCardsBucket.bucketName,
      USER_POOL_ID: userPool.userPoolId,
      USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
    };

    const makeLambda = (
      name: string,
      entryPath: string,
      opts: Partial<lambdaNodejs.NodejsFunctionProps> = {},
    ): lambdaNodejs.NodejsFunction => {
      const functionName = `solo-${name}-${config.stage}`;
      const logGroup = new logs.LogGroup(this, `${name}LogGroup`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: config.removalPolicy,
      });
      return new lambdaNodejs.NodejsFunction(this, name, {
        functionName,
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        entry: resolveEntryPath(entryPath),
        handler: "handler",
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: sharedEnv,
        logGroup,
        bundling: {
          minify: true,
          sourceMap: true,
          target: "node20",
          externalModules: ["@aws-sdk/*"],
        },
        ...opts,
      });
    };

    const syncStats = makeLambda("syncStats", "lambda/syncStats/index.ts", {
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
    });
    const getMyStats = makeLambda("getMyStats", "lambda/getMyStats/index.ts", {
      memorySize: 128,
      timeout: cdk.Duration.seconds(3),
    });
    const getMyTier = makeLambda("getMyTier", "lambda/getMyTier/index.ts", {
      memorySize: 128,
      timeout: cdk.Duration.seconds(3),
    });
    const getLeaderboard = makeLambda("getLeaderboard", "lambda/getLeaderboard/index.ts", {
      memorySize: 512,
      timeout: cdk.Duration.seconds(5),
    });
    const getTierBoard = makeLambda("getTierBoard", "lambda/getTierBoard/index.ts", {
      memorySize: 512,
      timeout: cdk.Duration.seconds(5),
    });
    const generateCard = makeLambda("generateCard", "lambda/generateCard/index.ts", {
      memorySize: 1536,
      timeout: cdk.Duration.seconds(20),
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node20",
        externalModules: ["@aws-sdk/*"],
        // Ship the resvg WASM binary alongside the JS so the Lambda handler
        // can load it via `require.resolve()`. Without this, esbuild inlines
        // nothing and resvg crashes at `initWasm()`.
        nodeModules: ["@resvg/resvg-wasm", "satori"],
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (inputDir: string, outputDir: string) => [
            `cp ${inputDir}/node_modules/@resvg/resvg-wasm/index_bg.wasm ${outputDir}/node_modules/@resvg/resvg-wasm/index_bg.wasm || true`,
          ],
        },
      },
    });

    statsTable.grantReadWriteData(syncStats);
    statsTable.grantReadData(getMyStats);
    statsTable.grantReadData(getMyTier);
    statsTable.grantReadData(getLeaderboard);
    statsTable.grantReadData(getTierBoard);
    statsTable.grantReadData(generateCard);

    dailyActivityTable.grantReadWriteData(syncStats);
    dailyActivityTable.grantReadData(getMyStats);

    shareCardsTable.grantReadWriteData(generateCard);
    shareCardsBucket.grantWrite(generateCard);
    shareCardsBucket.grantRead(generateCard);

    const addRoute = (method: apigw.HttpMethod, route: string, fn: lambda.IFunction) => {
      this.httpApi.addRoutes({
        path: route,
        methods: [method],
        integration: new apigwInt.HttpLambdaIntegration(`${fn.node.id}Int`, fn),
      });
    };

    addRoute(apigw.HttpMethod.POST, "/v1/stats/sync", syncStats);
    addRoute(apigw.HttpMethod.GET, "/v1/stats/me", getMyStats);
    addRoute(apigw.HttpMethod.GET, "/v1/tier/me", getMyTier);
    addRoute(apigw.HttpMethod.GET, "/v1/leaderboard", getLeaderboard);
    addRoute(apigw.HttpMethod.GET, "/v1/leaderboard/tier/{tier}", getTierBoard);
    addRoute(apigw.HttpMethod.POST, "/v1/card/generate", generateCard);

    if (props.githubLinkStartFn) {
      addRoute(apigw.HttpMethod.POST, "/v1/github/link", props.githubLinkStartFn);
    }
    if (props.githubGetTokenFn) {
      addRoute(apigw.HttpMethod.GET, "/v1/github/token", props.githubGetTokenFn);
    }
    if (props.githubUnlinkFn) {
      addRoute(apigw.HttpMethod.DELETE, "/v1/github/link", props.githubUnlinkFn);
    }

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: this.httpApi.apiEndpoint,
      exportName: `solo-${config.stage}-api-endpoint`,
    });
  }
}
