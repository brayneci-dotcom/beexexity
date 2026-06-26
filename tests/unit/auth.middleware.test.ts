import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Mock the config module before importing the middleware
vi.mock('../../src/config/index.js', () => ({
  config: {
    jwt: {
      secret: 'test-secret-key',
      expiresIn: 3600,
    },
  },
}));

// Mock the database module to avoid connection issues
vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}));

import { authMiddleware } from '../../src/middleware/auth.middleware.js';

function createMockRequest(authHeader?: string): Partial<Request> {
  return {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
  };
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

describe('Auth Middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  describe('Missing or malformed Authorization header', () => {
    it('should return 401 when Authorization header is missing', () => {
      const req = createMockRequest() as Request;
      const res = createMockResponse() as Response;

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'MISSING_TOKEN',
        message: 'Authorization header is required',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header does not use Bearer scheme', () => {
      const req = createMockRequest('Basic dXNlcjpwYXNz') as Request;
      const res = createMockResponse() as Response;

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'INVALID_TOKEN_FORMAT',
        message: 'Authorization header must use Bearer scheme',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when token is empty after Bearer prefix', () => {
      const req = createMockRequest('Bearer ') as Request;
      const res = createMockResponse() as Response;

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'MISSING_TOKEN',
        message: 'Token is required after Bearer scheme',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Valid token', () => {
    it('should call next() and attach user to req when token is valid', () => {
      const payload = { sub: 'user-123', username: 'testuser', role: 'user' as const };
      const token = jwt.sign(payload, 'test-secret-key', { expiresIn: 3600 });
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const res = createMockResponse() as Response;

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeDefined();
      expect(req.user!.sub).toBe('user-123');
      expect(req.user!.username).toBe('testuser');
      expect(req.user!.role).toBe('user');
    });

    it('should attach admin role correctly', () => {
      const payload = { sub: 'admin-1', username: 'admin', role: 'admin' as const };
      const token = jwt.sign(payload, 'test-secret-key', { expiresIn: 3600 });
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const res = createMockResponse() as Response;

      authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user!.role).toBe('admin');
    });
  });

  describe('Expired token', () => {
    it('should return 401 with expiry message when token is expired', () => {
      const payload = { sub: 'user-123', username: 'testuser', role: 'user' as const };
      const token = jwt.sign(payload, 'test-secret-key', { expiresIn: -1 });
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const res = createMockResponse() as Response;

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'INVALID_TOKEN',
        message: 'Token has expired',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Tampered/invalid tokens', () => {
    it('should return 401 when token has invalid signature', () => {
      const payload = { sub: 'user-123', username: 'testuser', role: 'user' as const };
      const token = jwt.sign(payload, 'wrong-secret-key', { expiresIn: 3600 });
      const req = createMockRequest(`Bearer ${token}`) as Request;
      const res = createMockResponse() as Response;

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'INVALID_TOKEN',
        message: 'Token is invalid or has been tampered with',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when token is malformed', () => {
      const req = createMockRequest('Bearer not.a.valid.jwt.token') as Request;
      const res = createMockResponse() as Response;

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'INVALID_TOKEN',
        message: 'Token is invalid or has been tampered with',
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when token is completely garbage', () => {
      const req = createMockRequest('Bearer xyz123garbage') as Request;
      const res = createMockResponse() as Response;

      authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'INVALID_TOKEN',
        message: 'Token is invalid or has been tampered with',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
