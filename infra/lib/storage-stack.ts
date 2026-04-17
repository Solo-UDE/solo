import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import type { SoloStageConfig } from "./config.js";

export interface SoloStorageStackProps extends cdk.StackProps {
  readonly config: SoloStageConfig;
  readonly authenticatedRole: iam.Role;
}

export class SoloStorageStack extends cdk.Stack {
  public readonly shareCardsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SoloStorageStackProps) {
    super(scope, id, props);
    const { config, authenticatedRole } = props;

    this.shareCardsBucket = new s3.Bucket(this, "ShareCardsBucket", {
      bucketName: `solo-share-cards-${config.stage}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [
        {
          id: "expire-cards-after-7-days",
          enabled: true,
          expiration: cdk.Duration.days(7),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
      removalPolicy: config.removalPolicy,
      autoDeleteObjects: config.stage === "dev",
    });

    // See DataStack note: client-side direct S3 access is intentionally NOT
    // granted. Lambdas generate pre-signed URLs for clients to fetch cards,
    // keeping the bucket private and avoiding cross-stack IAM cycles.
    void authenticatedRole;

    new cdk.CfnOutput(this, "ShareCardsBucketName", {
      value: this.shareCardsBucket.bucketName,
      exportName: `solo-${config.stage}-share-cards-bucket`,
    });
    new cdk.CfnOutput(this, "ShareCardsBucketArn", {
      value: this.shareCardsBucket.bucketArn,
      exportName: `solo-${config.stage}-share-cards-bucket-arn`,
    });
  }
}
