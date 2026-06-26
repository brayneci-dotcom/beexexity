import { describe, it, expect, vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { forcePasswordResetMiddleware } from '../../src/middleware/password-reset.middleware.js';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    user: undefined,
    path: '/api/v1/inference/generate',
    ...overrides,
  } as unknown as Request;
}

function createMockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('forcePasswordResetMiddleware', () => {
  it('calls next() when req.user is undefined', () => {
    const req = createMockReq({ user: undefined });
    const res = createMockRes();
    const next: NextFunction = vi.fn();

    forcePasswordResetMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() when user does not have forcePasswordReset flag', () => {
    const req = createMockReq({
      user: { sub: '1', username: 'test', role: 'user', iat: 0, exp: 0 } as any,
    });
    const res = createMockRes();
    const next: NextFunction = vi.fn();

    forcePasswordResetMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next() when forcePasswordReset is false', () => {
    const req = createMockReq({
      user: { sub: '1', username: 'test', role: 'user', iat: 0, exp: 0, forcePasswordReset: false } as any,
    });
    const res = createMockRes();
    const next: NextFunction = vi.fn();

    forcePasswordResetMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 with PASSWORD_RESET_REQUIRED when forcePasswordReset is true and route is not change-password', () => {
    const req = createMockReq({
      user: { sub: '1', username: 'test', role: 'user', iat: 0, exp: 0, forcePasswordReset: true } as any,
      path: '/api/v1/inference/generate',
    });
    const res = createMockRes();
    const next: NextFunction = vi.fn();

    forcePasswordResetMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: 'PASSWORD_RESET_REQUIRED',
        message: 'Password change required before accessing this resource',
      },
    });
  });

  it('allows access to /auth/change-password even when forcePasswordReset is true', () => {
    const req = createMockReq({
      user: { sub: '1', username: 'test', role: 'user', iat: 0, exp: 0, forcePasswordReset: true } as any,
      path: '/api/v1/auth/change-password',
    });
    const res = createMockRes();
    const next: NextFunction = vi.fn();

    forcePasswordResetMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows access to /change-password path variant when forcePasswordReset is true', () => {
    const req = createMockReq({
      user: { sub: '1', username: 'test', role: 'user', iat: 0, exp: 0, forcePasswordReset: true } as any,
      path: '/change-password',
    });
    const res = createMockRes();
    const next: NextFunction = vi.fn();

    forcePasswordResetMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks other routes when forcePasswordReset is true', () => {
    const routes = ['/api/v1/models', '/api/v1/admin/users', '/api/v1/inference/generate'];

    for (const path of routes) {
      const req = createMockReq({
        user: { sub: '1', username: 'test', role: 'user', iat: 0, exp: 0, forcePasswordReset: true } as any,
        path,
      });
      const res = createMockRes();
      const next: NextFunction = vi.fn();

      forcePasswordResetMiddleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });
});
