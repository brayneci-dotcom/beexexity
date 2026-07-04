import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { forcePasswordResetMiddleware } from '../middleware/password-reset.middleware.js';
import { adminMiddleware } from '../middleware/admin.middleware.js';
import { createUser, updateUser, upsertUser } from '../services/auth.service.js';
import { getCostReport } from '../services/cost-reporting.service.js';
import { TokenPayload } from '../types/auth.types.js';
import { ErrorResponse } from '../types/error.types.js';

/**
 * Admin routes — user management endpoints restricted to admin role.
 * @see Requirements 2.1, 2.2, 2.3, 2.4
 */
const router = Router();

// Apply auth + admin guard to all admin routes
router.use(authMiddleware);
router.use(forcePasswordResetMiddleware);
router.use(adminMiddleware);

/**
 * POST /api/v1/admin/users
 * Register a new user in the Whitelist_DB.
 * Returns 201 with created user profile, 409 on duplicate username.
 */
router.post('/users', async (req: Request, res: Response): Promise<void> => {
  const { username, password, role, displayName, groupName } = req.body;

  // Validate required fields
  if (!username || !password || !role || !displayName) {
    const error: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'username, password, role, and displayName are required',
    };
    res.status(400).json(error);
    return;
  }

  // Validate field types
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    typeof role !== 'string' ||
    typeof displayName !== 'string'
  ) {
    const error: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'username, password, role, and displayName must be strings',
    };
    res.status(400).json(error);
    return;
  }
  if (groupName !== undefined && typeof groupName !== 'string') {
    const error: ErrorResponse = { error: 'VALIDATION_ERROR', message: 'groupName must be a string' };
    res.status(400).json(error);
    return;
  }

  // Validate role value
  if (role !== 'admin' && role !== 'user') {
    const error: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'role must be either "admin" or "user"',
    };
    res.status(400).json(error);
    return;
  }

  try {
    const admin = req.user as TokenPayload;
    const userProfile = await createUser(admin, { username, password, role, displayName, groupName });
    res.status(201).json(userProfile);
  } catch (err: unknown) {
    if (err instanceof Error && (err as Error & { statusCode?: number }).statusCode === 409) {
      const error: ErrorResponse = {
        error: 'USERNAME_EXISTS',
        message: 'Username already taken',
      };
      res.status(409).json(error);
      return;
    }
    const error: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
    res.status(500).json(error);
  }
});

/**
 * PUT /api/v1/admin/users/:username
 * Update an existing user's profile fields (role, displayName, password).
 * Returns 200 with updated user profile, 404 if user not found.
 */
router.put('/users/:username', async (req: Request, res: Response): Promise<void> => {
  const username = req.params.username as string;
  const { role, displayName, groupName, password, forcePasswordReset } = req.body;

  // At least one updatable field must be provided
  if (role === undefined && displayName === undefined && groupName === undefined && password === undefined && forcePasswordReset === undefined) {
    const error: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'At least one field must be provided for update',
    };
    res.status(400).json(error);
    return;
  }

  // Validate role if provided
  if (role !== undefined) {
    if (typeof role !== 'string' || (role !== 'admin' && role !== 'user')) {
      const error: ErrorResponse = {
        error: 'VALIDATION_ERROR',
        message: 'role must be either "admin" or "user"',
      };
      res.status(400).json(error);
      return;
    }
  }

  // Validate displayName if provided
  if (displayName !== undefined && typeof displayName !== 'string') {
    const error: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'displayName must be a string',
    };
    res.status(400).json(error);
    return;
  }

  // Validate groupName if provided
  if (groupName !== undefined && typeof groupName !== 'string') {
    const error: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'groupName must be a string',
    };
    res.status(400).json(error);
    return;
  }

  // Validate password if provided
  if (password !== undefined && (typeof password !== 'string' || password.length < 6)) {
    const error: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'password must be a string with at least 6 characters',
    };
    res.status(400).json(error);
    return;
  }

  try {
    const admin = req.user as TokenPayload;
    const userProfile = await updateUser(admin, username, { role, displayName, groupName, password, forcePasswordReset });
    res.status(200).json(userProfile);
  } catch (err: unknown) {
    if (err instanceof Error && (err as Error & { statusCode?: number }).statusCode === 404) {
      const error: ErrorResponse = {
        error: 'USER_NOT_FOUND',
        message: 'User not found',
      };
      res.status(404).json(error);
      return;
    }
    // Unexpected error — return 500 without exposing internals
    const error: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
    res.status(500).json(error);
  }
});

/**
 * POST /api/v1/admin/users/bulk
 *
 * Bulk upsert users. Each entry is upserted (create if missing, update if exists).
 * Processes all entries and returns per-item results with errors.
 * Validation fails fast — rejects the entire batch if the payload is invalid.
 */
router.post('/users/bulk', async (req: Request, res: Response): Promise<void> => {
  const entries = req.body;

  if (!Array.isArray(entries) || entries.length === 0) {
    const error: ErrorResponse = { error: 'VALIDATION_ERROR', message: 'Request body must be a non-empty JSON array' };
    res.status(400).json(error);
    return;
  }

  if (entries.length > 1000) {
    const error: ErrorResponse = { error: 'VALIDATION_ERROR', message: 'Maximum 1000 users per bulk upload' };
    res.status(400).json(error);
    return;
  }

  // Validate each entry schema
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== 'object') {
      const error: ErrorResponse = { error: 'VALIDATION_ERROR', message: `Entry ${i} must be an object` };
      res.status(400).json(error);
      return;
    }
    if (!entry.username || typeof entry.username !== 'string') {
      const error: ErrorResponse = { error: 'VALIDATION_ERROR', message: `Entry ${i}: username is required` };
      res.status(400).json(error);
      return;
    }
    if (!entry.role || (entry.role !== 'admin' && entry.role !== 'user')) {
      const error: ErrorResponse = { error: 'VALIDATION_ERROR', message: `Entry ${i}: role must be "admin" or "user"` };
      res.status(400).json(error);
      return;
    }
    if (!entry.password || typeof entry.password !== 'string' || entry.password.length < 6) {
      const error: ErrorResponse = { error: 'VALIDATION_ERROR', message: `Entry ${i}: password must be at least 6 characters` };
      res.status(400).json(error);
      return;
    }
    if (entry.forcePasswordReset !== undefined && typeof entry.forcePasswordReset !== 'boolean') {
      const error: ErrorResponse = { error: 'VALIDATION_ERROR', message: `Entry ${i}: forcePasswordReset must be boolean` };
      res.status(400).json(error);
      return;
    }
    if (entry.displayName !== undefined && typeof entry.displayName !== 'string') {
      const error: ErrorResponse = { error: 'VALIDATION_ERROR', message: `Entry ${i}: displayName must be a string` };
      res.status(400).json(error);
      return;
    }
  }

  const results: Array<{ username: string; action: string; success: boolean; error?: string }> = [];

  // Process sequentially (not parallel) to avoid DB write contention
  for (const entry of entries) {
    try {
      const { action, user } = await upsertUser({
        username: entry.username,
        displayName: entry.displayName || entry.username,
        groupName: entry.groupName || undefined,
        role: entry.role,
        password: entry.password,
        forcePasswordReset: entry.forcePasswordReset ?? true,
      });
      results.push({ username: entry.username, action, success: true });
    } catch (err: unknown) {
      results.push({
        username: entry.username,
        action: 'skipped',
        success: false,
        error: (err as Error).message,
      });
    }
  }

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  res.status(200).json({ total: entries.length, successful, failed, results });
});

/**
 * GET /api/v1/admin/usage/cost
 *
 * Returns a paginated per-user cost report aggregated from audit_logs.
 * Cost is computed from per-request pricing snapshots stored at inference time.
 *
 * Query params:
 *   - from     (ISO date, optional)  Earliest timestamp to include (inclusive)
 *   - to       (ISO date, optional)  Latest date to include (inclusive — full day)
 *   - page     (number, default 1)
 *   - pageSize (number, default 20, max 100)
 *
 * Response: CostReportResponse
 */
router.get('/usage/cost', async (req: Request, res: Response): Promise<void> => {
  const from = typeof req.query.from === 'string' && req.query.from.trim()
    ? req.query.from.trim() : undefined;
  const to = typeof req.query.to === 'string' && req.query.to.trim()
    ? req.query.to.trim() : undefined;

  if (from && isNaN(Date.parse(from))) {
    const error: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'Invalid "from" date format. Use ISO 8601 (e.g., 2026-06-01).',
    };
    res.status(400).json(error);
    return;
  }
  if (to && isNaN(Date.parse(to))) {
    const error: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'Invalid "to" date format. Use ISO 8601 (e.g., 2026-06-01).',
    };
    res.status(400).json(error);
    return;
  }

  const page = Math.max(1, parseInt(String(req.query.page ?? ''), 10) || 1);
  const rawPageSize = parseInt(String(req.query.pageSize ?? ''), 10) || 20;
  const pageSize = Math.min(100, Math.max(1, rawPageSize));

  try {
    const report = await getCostReport(from, to, page, pageSize);
    res.status(200).json(report);
  } catch (err: unknown) {
    console.error('[admin] Cost report failed:', (err as Error).message);
    const error: ErrorResponse = {
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
    res.status(500).json(error);
  }
});

export default router;
