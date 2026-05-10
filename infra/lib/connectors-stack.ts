import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
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

export interface SoloConnectorsStackProps extends cdk.StackProps {
  readonly config: SoloStageConfig;
}

export class SoloConnectorsStack extends cdk.Stack {
  public readonly tokenEncryptionKey: kms.Key;
  public readonly tokensTable: dynamodb.Table;
  public readonly listTokensLambda: lambdaNodejs.NodejsFunction;
  public readonly getTokenLambda: lambdaNodejs.NodejsFunction;
  public readonly putTokenLambda: lambdaNodejs.NodejsFunction;
  public readonly deleteTokenLambda: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: SoloConnectorsStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.tokenEncryptionKey = new kms.Key(this, "ConnectorTokenEncryptionKey", {
      alias: `alias/solo-connector-tokens-${config.stage}`,
      description: "Encrypts Solo connector OAuth tokens at rest in DynamoDB",
      enableKeyRotation: true,
      removalPolicy: config.removalPolicy,
    });

    this.tokensTable = new dynamodb.Table(this, "ConnectorTokensTable", {
      tableName: `solo-connector-tokens-${config.stage}`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "connectorKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.tokenEncryptionKey,
      removalPolicy: config.removalPolicy,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.pointInTimeRecovery,
      },
    });
    this.tokensTable.addGlobalSecondaryIndex({
      indexName: "by-provider",
      partitionKey: { name: "provider", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "updatedAt", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    const makeLambda = (
      name: string,
      entryPath: string,
      opts: Partial<lambdaNodejs.NodejsFunctionProps> = {},
    ): lambdaNodejs.NodejsFunction => {
      const functionName = `solo-connectors-${name}-${config.stage}`;
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
        logGroup,
        environment: {
          STAGE: config.stage,
          CONNECTOR_TOKENS_TABLE: this.tokensTable.tableName,
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

    this.listTokensLambda = makeLambda("listTokens", "lambda/connectors/listTokens.ts");
    this.getTokenLambda = makeLambda("getToken", "lambda/connectors/getToken.ts");
    this.putTokenLambda = makeLambda("putToken", "lambda/connectors/putToken.ts");
    this.deleteTokenLambda = makeLambda("deleteToken", "lambda/connectors/deleteToken.ts");

    for (const fn of [
      this.listTokensLambda,
      this.getTokenLambda,
      this.putTokenLambda,
      this.deleteTokenLambda,
    ]) {
      this.tokensTable.grantReadWriteData(fn);
    }

    new cdk.CfnOutput(this, "ConnectorTokensTableName", {
      value: this.tokensTable.tableName,
      exportName: `solo-${config.stage}-connector-tokens-table`,
    });
    new cdk.CfnOutput(this, "ConnectorTokenKeyArn", {
      value: this.tokenEncryptionKey.keyArn,
      exportName: `solo-${config.stage}-connector-token-key-arn`,
    });
  }
}
