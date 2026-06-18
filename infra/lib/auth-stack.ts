import { Stack, type StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';

/**
 * AuthStack provisions the Cognito user pool that backs bowli sign-in.
 *
 * MVP scope (CLAUDE.md §2): email sign-in. Apple / Google federated IdPs are a
 * parked-but-designed-around concern — the structure below leaves a clear seam:
 * add `cognito.UserPoolIdentityProviderApple` / `...Google` constructs (with
 * their real secrets supplied via SSM/Secrets Manager at deploy time), then add
 * `cognito.UserPoolClientIdentityProvider.APPLE/GOOGLE` to the client's
 * `supportedIdentityProviders` and a hosted-UI domain. No schema/route changes
 * are needed when that lands.
 */
export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly issuer: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'BowliUserPool', {
      userPoolName: 'bowli-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireDigits: true,
        requireUppercase: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // MVP convenience: destroy on stack deletion. Tighten to RETAIN before any
      // real user data lands.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // App client used by the Expo app. No client secret (public/native client);
    // SRP + refresh-token auth flows. When federated IdPs are added, list them
    // in `supportedIdentityProviders` here.
    this.userPoolClient = this.userPool.addClient('BowliAppClient', {
      userPoolClientName: 'bowli-mobile',
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: false,
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
    });

    // Issuer URL the Go verifier checks the `iss` claim against and derives the
    // JWKS endpoint from.
    this.issuer = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}`;

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
    });
    new CfnOutput(this, 'CognitoIssuer', { value: this.issuer });
  }
}
