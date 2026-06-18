#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack.js';
import { DbStack } from '../lib/db-stack.js';
import { ApiStack } from '../lib/api-stack.js';

// Account/region come from the standard CDK env vars at deploy time. Left
// undefined for synth so no AWS credentials are required (env-agnostic synth).
const env =
  process.env.CDK_DEFAULT_ACCOUNT && process.env.CDK_DEFAULT_REGION
    ? { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
    : undefined;

const app = new App();

const auth = new AuthStack(app, 'BowliAuthStack', { env });
new DbStack(app, 'BowliDbStack', { env });
new ApiStack(app, 'BowliApiStack', { env, userPool: auth.userPool });

app.synth();
