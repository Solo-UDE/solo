import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import type { SoloStageConfig } from "./config.js";

export interface SoloDataStackProps extends cdk.StackProps {
  readonly config: SoloStageConfig;
  readonly authenticatedRole: iam.Role;
}

export class SoloDataStack extends cdk.Stack {
  public readonly statsTable: dynamodb.Table;
  public readonly dailyActivityTable: dynamodb.Table;
  public readonly shareCardsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: SoloDataStackProps) {
    super(scope, id, props);
    const { config, authenticatedRole } = props;

    this.statsTable = new dynamodb.Table(this, "StatsTable", {
      tableName: `solo-user-stats-${config.stage}`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.pointInTimeRecovery,
      },
      removalPolicy: config.removalPolicy,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    this.statsTable.addGlobalSecondaryIndex({
      indexName: "leaderboard-index",
      partitionKey: { name: "global_partition", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "score", type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.statsTable.addGlobalSecondaryIndex({
      indexName: "tier-leaderboard-index",
      partitionKey: { name: "tier", type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: "score", type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    this.dailyActivityTable = new dynamodb.Table(this, "DailyActivityTable", {
      tableName: `solo-daily-activity-${config.stage}`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "date", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: config.pointInTimeRecovery,
      },
      removalPolicy: config.removalPolicy,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    this.shareCardsTable = new dynamodb.Table(this, "ShareCardsTable", {
      tableName: `solo-share-cards-${config.stage}`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "cardId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: config.removalPolicy,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Note: client-side direct DynamoDB access is intentionally NOT granted.
    // All reads/writes go through API Gateway → Lambda, which uses its own role.
    // This is both simpler (no cross-stack IAM circular dep) and more secure
    // (server-side validation on every call). The `authenticatedRole` referenced
    // in props is retained for future direct-access use cases (e.g. pre-signed
    // S3 uploads); unused today. The prop is kept so the stack signature is
    // stable even if we re-enable direct access later.
    void authenticatedRole;

    new cdk.CfnOutput(this, "StatsTableName", {
      value: this.statsTable.tableName,
      exportName: `solo-${config.stage}-stats-table`,
    });
    new cdk.CfnOutput(this, "DailyActivityTableName", {
      value: this.dailyActivityTable.tableName,
      exportName: `solo-${config.stage}-daily-activity-table`,
    });
    new cdk.CfnOutput(this, "ShareCardsTableName", {
      value: this.shareCardsTable.tableName,
      exportName: `solo-${config.stage}-share-cards-table`,
    });
  }
}
