/**
 * AWS Lambda handler — wraps the Express app for Lambda execution.
 * Uses @vendia/serverless-express to translate API Gateway / Function URL events
 * into Express requests and responses.
 *
 * Supports:
 * - API Gateway HTTP API (v2 payload format)
 * - Lambda Function URL (RESPONSE_STREAM for SSE)
 *
 * The handler is a standard Lambda handler function that receives
 * (event, context) and returns a response.
 */
import serverlessExpress from '@vendia/serverless-express';
import app from './app.js';

// Configure returns a handler function: (event, context) => Promise<response>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const serverlessApp = (serverlessExpress as any).configure({ app });

/**
 * Lambda entry point.
 * Dockerfile.lambda CMD points to "dist/lambda.handler"
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = (event: any, context: any) => {
  return serverlessApp(event, context);
};
