import * as path from 'node:path';
import { Stack, type StackProps, Duration, CfnOutput } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

export interface ApiStackProps extends StackProps {
  /** The Cognito user pool whose JWTs guard the /sync routes. */
  readonly userPool: cognito.IUserPool;
}

/**
 * ApiStack fronts the Go sync service with API Gateway (REST) → Lambda, and
 * guards the /sync/* routes with a Cognito authorizer referencing the user pool
 * from AuthStack.
 *
 * Deploy note: the Lambda points at a placeholder `bootstrap` asset (see
 * infra/lambda-placeholder). The real Go binary bundling — cross-compile
 * services/api to a linux/arm64 `bootstrap` for the provided.al2023 custom
 * runtime — is wired at deploy time, not at synth. Synth only needs a valid
 * asset to package, which the placeholder provides.
 */
export class ApiStack extends Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const handler = new lambda.Function(this, 'BowliApiFn', {
      functionName: 'bowli-api',
      // Custom runtime for the Go binary. The handler name is ignored by
      // provided.* runtimes (the bootstrap binary is the entrypoint).
      runtime: lambda.Runtime.PROVIDED_AL2023,
      architecture: lambda.Architecture.ARM_64,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda-placeholder')),
      timeout: Duration.seconds(29), // API Gateway integration cap.
      memorySize: 256,
      environment: {
        // DATABASE_URL is injected at deploy from the DbStack secret; left out
        // here so synth doesn't require the cross-stack secret reference.
        COGNITO_ISSUER: `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`,
      },
    });

    this.api = new apigateway.RestApi(this, 'BowliApi', {
      restApiName: 'bowli-api',
      description: 'bowli offline-first sync API',
      deployOptions: { stageName: 'v1' },
    });

    // Cognito authorizer (type COGNITO_USER_POOLS) referencing the user pool.
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'BowliCognitoAuthorizer',
      {
        cognitoUserPools: [props.userPool],
        authorizerName: 'bowli-cognito',
      },
    );

    const lambdaIntegration = new apigateway.LambdaIntegration(handler);

    // /health is public (no authorizer) — used by load balancers / uptime checks.
    const health = this.api.root.addResource('health');
    health.addMethod('GET', lambdaIntegration);

    // /sync/* requires a valid Cognito JWT.
    const sync = this.api.root.addResource('sync');
    const authedMethodOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };
    const push = sync.addResource('push');
    push.addMethod('POST', lambdaIntegration, authedMethodOptions);
    const pull = sync.addResource('pull');
    pull.addMethod('GET', lambdaIntegration, authedMethodOptions);

    new CfnOutput(this, 'ApiUrl', { value: this.api.url });
  }
}
