import { EventEmitter } from 'events';
import app from './app.js';
import { config } from './config/index.js';

/**
 * HTTP server startup.
 * Listens on the port defined in config (defaults to 3000).
 *
 * Raise EventEmitter limit — sequential reasoning creates many concurrent
 * Bedrock calls (planner + N steps with retries + synthesis), each adding
 * HTTP close listeners. Default 10 is too low.
 */
EventEmitter.defaultMaxListeners = 50;

const port = config.server.port;

app.listen(port, () => {
  console.log(`[Server] Unified Inference Gateway running on port ${port}`);
  console.log(`[Server] Region: ${config.aws.region}`);
});
