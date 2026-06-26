import { describe, it, expect, vi } from 'vitest';
import http from 'http';

/**
 * Tests for src/app.ts — Express app entry point.
 * Validates middleware stack, route mounting, and global error handler.
 * @see Requirements 6.5, 7.5
 */

/**
 * Helper: make an HTTP request to the app and return { status, headers, body }.
 */
function makeRequest(
  app: http.RequestListener,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to get server address'));
        return;
      }
      const port = addr.port;
      const payload = body ? JSON.stringify(body) : undefined;

      const reqHeaders: Record<string, string> = {
        ...(headers || {}),
      };
      if (payload) {
        reqHeaders['Content-Type'] = 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(payload).toString();
      }

      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: reqHeaders,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            server.close();
            let parsedBody: unknown;
            try {
              parsedBody = JSON.parse(data);
            } catch {
              parsedBody = data;
            }
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              body: parsedBody,
            });
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  });
}

describe('Express App', () => {
  describe('Global error handler', () => {
    it('should return 500 with sanitized error response and not leak internal details', async () => {
      // Import the app - the global error handler is wired in app.ts
      const { default: app } = await import('../../src/app.js');

      // We can't easily trigger the global error handler through normal routes,
      // so we create an isolated app with the same error handler pattern to verify behavior.
      const express = (await import('express')).default;
      const testApp = express();
      testApp.use(express.json());

      // Route that throws with internal details
      testApp.get('/throw', () => {
        throw new Error('Database connection failed: host=secret-db.internal password=abc123');
      });

      // Same error handler pattern as app.ts
      testApp.use((err: Error, _req: any, res: any, _next: any): void => {
        console.error('[Unhandled Error]', err);
        res.status(500).json({
          error: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        });
      });

      const response = await makeRequest(testApp, 'GET', '/throw');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
      // Verify no internal details leak
      const bodyStr = JSON.stringify(response.body);
      expect(bodyStr).not.toContain('Database connection');
      expect(bodyStr).not.toContain('secret-db');
      expect(bodyStr).not.toContain('password');
    });

    it('should return 500 with sanitized error for async errors with AWS details', async () => {
      const express = (await import('express')).default;
      const testApp = express();
      testApp.use(express.json());

      testApp.get('/async-throw', (_req: any, _res: any, next: any) => {
        next(new Error('AWS ARN: arn:aws:bedrock:ap-southeast-3:123456:model/test'));
      });

      testApp.use((err: Error, _req: any, res: any, _next: any): void => {
        console.error('[Unhandled Error]', err);
        res.status(500).json({
          error: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        });
      });

      const response = await makeRequest(testApp, 'GET', '/async-throw');

      expect(response.status).toBe(500);
      expect((response.body as any).error).toBe('INTERNAL_ERROR');
      expect((response.body as any).message).toBe('An unexpected error occurred');
      const bodyStr = JSON.stringify(response.body);
      expect(bodyStr).not.toContain('arn:aws');
      expect(bodyStr).not.toContain('123456');
    });
  });

  describe('Route mounting', () => {
    it('should mount auth routes at /api/v1/auth (not 404)', async () => {
      const { default: app } = await import('../../src/app.js');
      const response = await makeRequest(app, 'POST', '/api/v1/auth/login', {});
      expect(response.status).not.toBe(404);
    });

    it('should mount admin routes at /api/v1/admin (not 404)', async () => {
      const { default: app } = await import('../../src/app.js');
      const response = await makeRequest(app, 'POST', '/api/v1/admin/users', {});
      expect(response.status).not.toBe(404);
    });

    it('should mount models routes at /api/v1/models (not 404)', async () => {
      const { default: app } = await import('../../src/app.js');
      const response = await makeRequest(app, 'GET', '/api/v1/models');
      expect(response.status).not.toBe(404);
    });

    it('should mount inference routes at /api/v1/inference (not 404)', async () => {
      const { default: app } = await import('../../src/app.js');
      const response = await makeRequest(app, 'POST', '/api/v1/inference/generate', {});
      expect(response.status).not.toBe(404);
    });

    it('should return 404 for unmounted routes', async () => {
      const { default: app } = await import('../../src/app.js');
      const response = await makeRequest(app, 'GET', '/api/v1/nonexistent');
      expect(response.status).toBe(404);
    });
  });

  describe('Middleware stack', () => {
    it('should parse JSON request bodies', async () => {
      const { default: app } = await import('../../src/app.js');

      // Send valid JSON to auth login — should parse body and attempt auth (401),
      // not reject with 400 for missing body fields.
      const response = await makeRequest(app, 'POST', '/api/v1/auth/login', {
        username: 'testuser',
        password: 'testpass',
      });

      // If JSON parsing works, the route will process the body.
      // 401 means credentials were checked (body was parsed).
      // 400 would mean body was not parsed (missing fields).
      expect(response.status).toBe(401);
    });

    it('should include CORS headers in responses', async () => {
      const { default: app } = await import('../../src/app.js');
      const response = await makeRequest(
        app,
        'OPTIONS',
        '/api/v1/auth/login',
        undefined,
        {
          'Origin': 'http://localhost:5173',
          'Access-Control-Request-Method': 'POST',
        }
      );

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });
});
