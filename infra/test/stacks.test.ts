import { describe, it } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AuthStack } from '../lib/auth-stack.js';
import { DbStack } from '../lib/db-stack.js';
import { ApiStack } from '../lib/api-stack.js';

describe('AuthStack', () => {
  const app = new App();
  const stack = new AuthStack(app, 'TestAuth');
  const template = Template.fromStack(stack);

  it('creates a Cognito user pool with email sign-in', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1);
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: Match.arrayWith(['email']),
    });
  });

  it('creates a user pool client without a secret', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
    });
  });
});

describe('DbStack', () => {
  const app = new App();
  const stack = new DbStack(app, 'TestDb');
  const template = Template.fromStack(stack);

  it('creates an aurora-postgresql cluster with serverless v2 scaling', () => {
    template.resourceCountIs('AWS::RDS::DBCluster', 1);
    template.hasResourceProperties('AWS::RDS::DBCluster', {
      Engine: 'aurora-postgresql',
      ServerlessV2ScalingConfiguration: {
        MinCapacity: 0.5,
        MaxCapacity: 4,
      },
    });
  });

  it('provisions a serverless v2 writer instance', () => {
    template.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.serverless',
    });
  });
});

describe('ApiStack', () => {
  const app = new App();
  const auth = new AuthStack(app, 'TestAuthForApi');
  const stack = new ApiStack(app, 'TestApi', { userPool: auth.userPool });
  const template = Template.fromStack(stack);

  it('creates a REST API and a Lambda function', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'provided.al2023',
    });
  });

  it('has a Cognito user pools authorizer', () => {
    template.resourceCountIs('AWS::ApiGateway::Authorizer', 1);
    template.hasResourceProperties('AWS::ApiGateway::Authorizer', {
      Type: 'COGNITO_USER_POOLS',
    });
  });

  it('guards the /sync routes with COGNITO authorization', () => {
    // Both /sync/push (POST) and /sync/pull (GET) require COGNITO auth.
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
      AuthorizationType: 'COGNITO_USER_POOLS',
    });
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      AuthorizationType: 'COGNITO_USER_POOLS',
    });
  });
});
