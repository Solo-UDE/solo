import { RemovalPolicy } from "aws-cdk-lib";

export type Stage = "dev" | "prod";

export interface SoloStageConfig {
  readonly stage: Stage;
  readonly region: string;
  readonly cognitoDomainPrefix: string;
  readonly removalPolicy: RemovalPolicy;
  readonly pointInTimeRecovery: boolean;
  readonly githubOidcEnabled: boolean;
  readonly googleOidcEnabled: boolean;
  readonly apiThrottling: {
    readonly rateLimit: number;
    readonly burstLimit: number;
  };
}

const DEV: SoloStageConfig = {
  stage: "dev",
  region: "us-east-1",
  cognitoDomainPrefix: "solo-ide-dev",
  removalPolicy: RemovalPolicy.DESTROY,
  pointInTimeRecovery: false,
  githubOidcEnabled: true,
  googleOidcEnabled: true,
  apiThrottling: { rateLimit: 10, burstLimit: 100 },
};

const PROD: SoloStageConfig = {
  stage: "prod",
  region: "us-east-1",
  cognitoDomainPrefix: "solo-ide-prod",
  removalPolicy: RemovalPolicy.RETAIN,
  pointInTimeRecovery: true,
  githubOidcEnabled: true,
  googleOidcEnabled: true,
  apiThrottling: { rateLimit: 50, burstLimit: 500 },
};

export function resolveStageConfig(stage: string): SoloStageConfig {
  switch (stage) {
    case "dev":
      return DEV;
    case "prod":
      return PROD;
    default:
      throw new Error(`Unknown stage: ${stage}. Use -c stage=dev or -c stage=prod.`);
  }
}
