import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth.service.js';
import { TokenPayload } from '../types/auth.types.js';

/**
 * Extend Express Request to include the decoded user payload.
 */
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Auth middleware — validates JWT on protected routes.
 * Extracts Bearer token from the Authorization header, verifies signature and expiry,
 * and attaches the decoded TokenPayload to req.user.
 *
 * Returns 401 with a descriptive message for:
 * - Missing Authorization header
 * - Malformed Authorization header (not Bearer scheme)
 * - Expired tokens
 * - Tampered/invalid signature tokens
 *
 * @see Requirements 1.4, 1.5
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: 'MISSING_TOKEN',
      message: 'Authorization header is required',
    });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'INVALID_TOKEN_FORMAT',
      message: 'Authorization header must use Bearer scheme',
    });
    return;
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  if (!token) {
    res.status(401).json({
      error: 'MISSING_TOKEN',
      message: 'Token is required after Bearer scheme',
    });
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    res.status(401).json({
      error: 'INVALID_TOKEN',
      message,
    });
  }
}

/**
 * Maps JWT verification errors to descriptive user-facing messages.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TokenExpiredError') {
      return 'Token has expired';
    }
    if (error.name === 'JsonWebTokenError') {
      return 'Token is invalid or has been tampered with';
    }
    if (error.name === 'NotBeforeError') {
      return 'Token is not yet active';
    }
  }
  return 'Token invalid or expired';
}
