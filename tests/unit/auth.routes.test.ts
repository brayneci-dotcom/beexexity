import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import authRouter from '../../src/routes/auth.routes.js';

// Mock the auth service
vi.mock('../../src/services/auth.service.js', () => ({
  login: vi.fn(),
}));

import { login } from '../../src/services/auth.service.js';

const mockLogin = vi.mocked(login);

/**
 * Helper to simulate a POST request to the router.
 * We exercise the router's handler by finding the registered POST /login route
 * and calling its handler directly with mock req/res objects.
 */
function createMockRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis() as unknown as Response['status'],
    json: vi.fn().mockReturnThis() as unknown as Response['json'],
  };
  return res as Response;
}

function createMockReq(body: unknown): Request {
  return { body } as Request;
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (req: Request, res: Response) => Promise<void> }>;
  };
}

// Extract the handler for POST /login from the router
function getLoginHandler() {
  const stack = (authRouter as unknown as { stack: RouteLayer[] }).stack;
  const layer = stack.find(
    (l) => l.route?.path === '/login' && l.route?.methods?.post,
  );
  if (!layer || !layer.route) {
    throw new Error('POST /login route not found on authRouter');
  }
  // Get the last handler (the actual route handler, after middleware like rate limiter)
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

describe('Auth Routes — POST /api/v1/auth/login', () => {
  let handler: (req: Request, res: Response) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = getLoginHandler();
  });

  it('should return 200 with token and user profile on valid credentials', async () => {
    const mockResult = {
      token: 'jwt-token-abc',
      expiresIn: 3600,
      user: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        username: 'testuser',
        role: 'user' as const,
        displayName: 'Test User',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    };

    mockLogin.mockResolvedValue(mockResult);

    const req = createMockReq({ username: 'testuser', password: 'correctpass' });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(mockResult);
    expect(mockLogin).toHaveBeenCalledWith('testuser', 'correctpass');
  });

  it('should return 401 with standard error format on invalid credentials', async () => {
    mockLogin.mockRejectedValue(new Error('Authentication failed'));

    const req = createMockReq({ username: 'testuser', password: 'wrongpass' });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'INVALID_CREDENTIALS',
      message: 'Authentication failed',
    });
  });

  it('should return 400 when username is missing', async () => {
    const req = createMockReq({ password: 'somepass' });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'VALIDATION_ERROR',
      message: 'Username and password are required',
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should return 400 when password is missing', async () => {
    const req = createMockReq({ username: 'testuser' });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'VALIDATION_ERROR',
      message: 'Username and password are required',
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should return 400 when body is empty', async () => {
    const req = createMockReq({});
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'VALIDATION_ERROR',
      message: 'Username and password are required',
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should return 400 when username or password are not strings', async () => {
    const req = createMockReq({ username: 123, password: true });
    const res = createMockRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'VALIDATION_ERROR',
      message: 'Username and password must be strings',
    });
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('should return 401 for any auth service error (opaque error handling)', async () => {
    mockLogin.mockRejectedValue(new Error('Some unexpected DB error'));

    const req = createMockReq({ username: 'testuser', password: 'somepass' });
    const res = createMockRes();

    await handler(req, res);

    // Even if an unexpected error occurs, the response is always 401 with opaque message
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'INVALID_CREDENTIALS',
      message: 'Authentication failed',
    });
  });

  it('should export the router as default export', () => {
    expect(authRouter).toBeDefined();
    // Verify it's an Express router (has use, get, post methods)
    expect(typeof (authRouter as unknown as Record<string, unknown>).use).toBe('function');
  });
});
