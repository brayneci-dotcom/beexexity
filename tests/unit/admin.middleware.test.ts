import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { adminMiddleware } from '../../src/middleware/admin.middleware.js';

function createMockRequest(user?: { sub: string; username: string; role: 'admin' | 'user'; iat: number; exp: number }): Partial<Request> {
  return { user };
}

function createMockResponse(): Partial<Response> & { statusCode?: number; body?: unknown } {
  const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
  res.status = vi.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = vi.fn().mockImplementation((data: unknown) => {
    res.body = data;
    return res;
  });
  return res;
}

describe('Admin Middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it('should call next() when user has admin role', () => {
    const req = createMockRequest({
      sub: 'admin-1',
      username: 'adminuser',
      role: 'admin',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }) as Request;
    const res = createMockResponse() as Response;

    adminMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 403 when user has non-admin role', () => {
    const req = createMockRequest({
      sub: 'user-123',
      username: 'regularuser',
      role: 'user',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }) as Request;
    const res = createMockResponse() as Response;

    adminMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'ACCESS_DENIED',
      message: 'Admin access required',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 when req.user is undefined (no auth middleware ran)', () => {
    const req = createMockRequest(undefined) as Request;
    const res = createMockResponse() as Response;

    adminMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: 'ACCESS_DENIED',
      message: 'Admin access required',
    });
    expect(next).not.toHaveBeenCalled();
  });
});
