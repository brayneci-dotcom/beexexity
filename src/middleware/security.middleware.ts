import { Request, Response, NextFunction } from 'express';

/**
 * Security headers middleware.
 * Sets recommended HTTP security headers to prevent common attacks.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Disable browser XSS filter (modern CSP is better)
  res.setHeader('X-XSS-Protection', '0');
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Strict Transport Security (enable when behind HTTPS)
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Remove Express fingerprint
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * Simple in-memory rate limiter.
 * Tracks requests per IP within a sliding window.
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, 60_000);

/**
 * Create a rate limiter middleware.
 * @param maxRequests - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 */
export function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${ip}:${req.baseUrl || ''}${req.path}`;
    const now = Date.now();

    const entry = rateLimitStore.get(key);

    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', (maxRequests - 1).toString());
      next();
      return;
    }

    entry.count++;

    if (entry.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000).toString());
      res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      });
      return;
    }

    res.setHeader('X-RateLimit-Limit', maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', (maxRequests - entry.count).toString());
    next();
  };
}

/**
 * Rate limiter specifically for login attempts (stricter).
 * 5 attempts per 15 minutes per IP.
 */
export const loginRateLimit = rateLimit(5, 15 * 60 * 1000);

/**
 * General API rate limiter.
 * 100 requests per minute per IP.
 */
export const apiRateLimit = rateLimit(100, 60 * 1000);

/**
 * Inference rate limiter.
 * 20 requests per minute per IP (LLM calls are expensive).
 */
export const inferenceRateLimit = rateLimit(20, 60 * 1000);
