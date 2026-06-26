import serverlessExpress from '@vendia/serverless-express';
import app from './app.js';

// @vendia/serverless-express default export is callable but TypeScript types don't reflect it.
// The callable accepts { app, binaryMimeTypes? } and returns a Lambda handler function.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (serverlessExpress as any)({
  app,
  binaryMimeTypes: [
    'image/*',
    'font/*',
    'application/octet-stream',
  ],
});

export { handler };
