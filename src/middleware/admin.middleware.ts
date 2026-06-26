import { Request, Response, NextFunction } from 'express';

/**
 * Admin role guard middleware.
 * Must be applied AFTER authMiddleware on admin-only routes.
 * Checks that the authenticated user has the 'admin' role.
 * Returns 403 with ACCESS_DENIED error if the user is not an admin.
 *
 * @see Requirements 2.4
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    res.status(403).json({
      error: 'ACCESS_DENIED',
      message: 'Admin access required',
    });
    return;
  }

  next();
}
