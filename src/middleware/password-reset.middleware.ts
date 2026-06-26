import { Request, Response, NextFunction } from 'express';

/**
 * Middleware that checks if the authenticated user has force_password_reset = true.
 * If so, rejects the request with 403 unless the route is the change-password endpoint.
 * Applied AFTER authMiddleware on protected routes.
 *
 * @see Requirements 1.3
 */
export function forcePasswordResetMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const user = req.user as Record<string, unknown> | undefined;

  if (user && user.forcePasswordReset === true) {
    // Allow access to the change-password endpoint
    if (req.path.includes('/change-password')) {
      next();
      return;
    }

    res.status(403).json({
      error: {
        code: 'PASSWORD_RESET_REQUIRED',
        message: 'Password change required before accessing this resource',
      },
    });
    return;
  }

  next();
}
