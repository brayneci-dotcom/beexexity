import app from './app.js';
import { config } from './config/index.js';

/**
 * HTTP server startup.
 * Listens on the port defined in config (defaults to 3000).
 */
const port = config.server.port;

app.listen(port, () => {
  console.log(`[Server] Unified Inference Gateway running on port ${port}`);
  console.log(`[Server] Region: ${config.aws.region}`);
});
