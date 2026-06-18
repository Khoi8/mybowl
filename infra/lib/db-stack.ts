import { Stack, type StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import type { Construct } from 'constructs';

/**
 * DbStack provisions the Aurora Serverless v2 PostgreSQL cluster that is the
 * cloud sync target (CLAUDE.md §2). Kept minimal but valid: a small VPC, a
 * single writer running on the Serverless v2 capacity range, credentials in
 * Secrets Manager.
 *
 * The Go service connects via DATABASE_URL; goose migrations (S20) run at
 * startup. Scaling floor of 0.5 ACU keeps idle cost low for the MVP.
 */
export class DbStack extends Stack {
  public readonly cluster: rds.DatabaseCluster;
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'BowliVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    this.cluster = new rds.DatabaseCluster(this, 'BowliDb', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      // Aurora Serverless v2 capacity range. Writer runs serverless v2.
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 4,
      writer: rds.ClusterInstance.serverlessV2('writer'),
      defaultDatabaseName: 'bowli',
      credentials: rds.Credentials.fromGeneratedSecret('bowli_admin'),
      backup: { retention: Duration.days(7) },
      // MVP convenience; tighten before real data lands.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new CfnOutput(this, 'ClusterEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
    });
    new CfnOutput(this, 'DbSecretArn', {
      value: this.cluster.secret?.secretArn ?? 'none',
    });
  }
}
