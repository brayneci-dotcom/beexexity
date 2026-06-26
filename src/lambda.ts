import serverlessExpress from '@vendia/serverless-express';
import app from './app.js';

// Create the serverless Express app with proper configuration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handler = (serverlessExpress as any)({
  app,
  binaryMimeTypes: [
    'text/html;charset=utf-8',
    'text/css',
    'application/javascript',
    'application/json',
    'image/svg+xml',
    'font/*',
  ],
});

export { handler };
