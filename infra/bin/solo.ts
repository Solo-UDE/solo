#!/usr/bin/env node
import "source-map-support/register.js";
import * as cdk from "aws-cdk-lib";
import { resolveStageConfig } from "../lib/config.js";
import { SoloAuthStack } from "../lib/auth-stack.js";
import { SoloDataStack } from "../lib/data-stack.js";
import { SoloStorageStack } from "../lib/storage-stack.js";
import { SoloApiStack } from "../lib/api-stack.js";
import { SoloConnectorsStack } from "../lib/connectors-stack.js";
import { SoloGitHubStack } from "../lib/github-stack.js";
import { SoloRdsStack } from "../lib/rds-stack.js";

const app = new cdk.App();

const stage = app.node.tryGetContext("stage") ?? "dev";
const config = resolveStageConfig(stage);

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: config.region,
};

cdk.Tags.of(app).add("Project", "solo");
cdk.Tags.of(app).add("Stage", config.stage);
cdk.Tags.of(app).add("ManagedBy", "cdk");

new SoloRdsStack(app, `SoloRds-${config.stage}`, {
  env,
  config,
  description: `Solo — RDS Postgres for solo-web (${config.stage})`,
});

const github = new SoloGitHubStack(app, `SoloGitHub-${config.stage}`, {
  env,
  config,
  description: `Solo — GitHub OIDC wrapper + token storage (${config.stage})`,
});

const connectors = new SoloConnectorsStack(app, `SoloConnectors-${config.stage}`, {
  env,
  config,
  description: `Solo — generic app connector token storage (${config.stage})`,
});

const auth = new SoloAuthStack(app, `SoloAuth-${config.stage}`, {
  env,
  config,
  githubOidcIssuerUrl: github.oidcApi.apiEndpoint,
  githubTokensTableName: github.tokensTable.tableName,
  githubPendingTableName: github.pendingTable.tableName,
  description: `Solo — Cognito auth (${config.stage})`,
});
auth.addDependency(github);

const data = new SoloDataStack(app, `SoloData-${config.stage}`, {
  env,
  config,
  authenticatedRole: auth.authenticatedRole,
  description: `Solo — DynamoDB tables (${config.stage})`,
});

const storage = new SoloStorageStack(app, `SoloStorage-${config.stage}`, {
  env,
  config,
  authenticatedRole: auth.authenticatedRole,
  description: `Solo — S3 share cards bucket (${config.stage})`,
});

const api = new SoloApiStack(app, `SoloApi-${config.stage}`, {
  env,
  config,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
  statsTable: data.statsTable,
  dailyActivityTable: data.dailyActivityTable,
  shareCardsTable: data.shareCardsTable,
  shareCardsBucket: storage.shareCardsBucket,
  githubLinkStartFn: github.linkStartLambda,
  githubGetTokenFn: github.getTokenLambda,
  githubUnlinkFn: github.unlinkLambda,
  connectorsListTokensFn: connectors.listTokensLambda,
  connectorsGetTokenFn: connectors.getTokenLambda,
  connectorsPutTokenFn: connectors.putTokenLambda,
  connectorsDeleteTokenFn: connectors.deleteTokenLambda,
  description: `Solo — API Gateway + Lambdas (${config.stage})`,
});
api.addDependency(connectors);
