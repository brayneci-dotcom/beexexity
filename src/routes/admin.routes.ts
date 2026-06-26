import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { forcePasswordResetMiddleware } from '../middleware/password-reset.middleware.js';
import { adminMiddleware } from '../middleware/admin.middleware.js';
import { createUser, updateUser } from '../services/auth.service.js';
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
  const { username, password, role, displayName } = req.body;

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
    const userProfile = await createUser(admin, { username, password, role, displayName });
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
    // Unexpected error — return 500 without exposing internals
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
  const { role, displayName, password } = req.body;

  // At least one updatable field must be provided
  if (role === undefined && displayName === undefined && password === undefined) {
    const error: ErrorResponse = {
      error: 'VALIDATION_ERROR',
      message: 'At least one field (role, displayName, password) must be provided for update',
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
    const userProfile = await updateUser(admin, username, { role, displayName, password });
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

export default router;
