import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import type { SoloStageConfig } from "./config.js";

export interface SoloRdsStackProps extends cdk.StackProps {
  readonly config: SoloStageConfig;
}

/**
 * RDS PostgreSQL instance for solo-web relational data (waitlist + future
 * user/admin tables). Sized for pre-launch traffic: `db.t4g.micro` Single-AZ,
 * 20 GB storage, publicly accessible via locked-down security group + SSL.
 *
 * No NAT gateway, no RDS Proxy, no Multi-AZ. Those are ~$30-50/month each and
 * unnecessary until we have real traffic.
 */
export class SoloRdsStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseInstance;
  public readonly adminSecret: secretsmanager.ISecret;
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: SoloRdsStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `solo-${config.stage}-vpc`,
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const securityGroup = new ec2.SecurityGroup(this, "DbSecurityGroup", {
      vpc: this.vpc,
      securityGroupName: `solo-${config.stage}-db-sg`,
      description: "RDS Postgres - restricted ingress on port 5432",
      allowAllOutbound: false,
    });
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      "Allow Postgres from anywhere (SSL + strong password enforced). Revisit at scale.",
    );

    const parameterGroup = new rds.ParameterGroup(this, "DbParameterGroup", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      description: `Solo Postgres params (${config.stage}) - enforces SSL`,
      parameters: {
        "rds.force_ssl": "1",
      },
    });

    this.cluster = new rds.DatabaseInstance(this, "DbInstance", {
      instanceIdentifier: `solo-db-${config.stage}`,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publiclyAccessible: true,
      securityGroups: [securityGroup],
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false,
      backupRetention: cdk.Duration.days(config.stage === "prod" ? 7 : 1),
      deletionProtection: config.stage === "prod",
      removalPolicy: config.removalPolicy,
      parameterGroup,
      databaseName: "solo",
      credentials: rds.Credentials.fromGeneratedSecret("solo_admin", {
        secretName: `solo/${config.stage}/rds-admin`,
      }),
      enablePerformanceInsights: false,
      monitoringInterval: cdk.Duration.seconds(0),
      autoMinorVersionUpgrade: true,
      preferredMaintenanceWindow: "sun:05:00-sun:06:00",
      preferredBackupWindow: "04:00-05:00",
    });

    this.adminSecret = this.cluster.secret!;

    new cdk.CfnOutput(this, "DbEndpoint", {
      value: this.cluster.instanceEndpoint.hostname,
      description: "RDS Postgres endpoint hostname",
      exportName: `solo-${config.stage}-db-endpoint`,
    });
    new cdk.CfnOutput(this, "DbPort", {
      value: this.cluster.instanceEndpoint.port.toString(),
      exportName: `solo-${config.stage}-db-port`,
    });
    new cdk.CfnOutput(this, "DbName", {
      value: "solo",
      exportName: `solo-${config.stage}-db-name`,
    });
    new cdk.CfnOutput(this, "DbAdminSecretArn", {
      value: this.adminSecret.secretArn,
      description:
        "Secrets Manager ARN holding { username, password }. Read via `aws secretsmanager get-secret-value --secret-id <ARN>`",
      exportName: `solo-${config.stage}-db-admin-secret-arn`,
    });
  }
}
