/**
 * AWS Lambda handler — wraps the Express app for Lambda execution.
 * Uses @vendia/serverless-express to translate Lambda Function URL / API Gateway
 * events into Express requests and responses.
 */
import serverlessExpress from '@vendia/serverless-express';
import app from './app.js';

// The default export of @vendia/serverless-express is a callable that accepts { app }
// and returns a handler function. We pass binaryMimeTypes so that binary content
// (images, fonts) is base64-encoded in the response, while text (HTML, CSS, JS) is not.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = (serverlessExpress as any)({
  app,
  binaryMimeTypes: [
    'image/*',
    'font/*',
    'application/octet-stream',
  ],
});
