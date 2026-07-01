import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { config } from '../config/index.js';
import { ChangePasswordResult, CreateUserDto, LoginResult, TokenPayload, UpdateUserDto, UserProfile } from '../types/auth.types.js';

const BCRYPT_SALT_ROUNDS = 12;

/**
 * Authentication service — credential validation and JWT token management.
 * @see Requirements 1.1, 1.2, 1.3
 */

/**
 * Authenticate a user by validating credentials against the Whitelist_DB.
 * Returns a signed JWT with sub, username, and role claims on success.
 * On failure, returns a generic error that does not reveal which credential was wrong.
 */
export async function login(username: string, password: string): Promise<LoginResult> {
  // Query user by username — use the same error for both "user not found" and "wrong password"
  // to avoid revealing which credential was incorrect. Log diagnostics server-side instead.
  let result;
  try {
    result = await query<{
      id: string;
      username: string;
      password: string;
      role: 'admin' | 'user';
      display_name: string;
      force_password_reset?: boolean;
      created_at: string;
      updated_at: string;
    }>(
      'SELECT id, username, password, role, display_name, force_password_reset, created_at, updated_at FROM users WHERE username = $1',
      [username],
    );
  } catch (dbError: unknown) {
    // Database connection / query failure — log full details for CloudWatch
    console.error('[auth] Database query failed during login:', {
      username,
      error: (dbError as Error).message,
      code: (dbError as any).code,
    });
    throw new Error('Authentication failed');
  }

  const user = result.rows[0];

  if (!user) {
    console.warn('[auth] Login failed: user not found', { username });
    throw new Error('Authentication failed');
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    console.warn('[auth] Login failed: password mismatch', { username });
    throw new Error('Authentication failed');
  }

  console.log('[auth] Login succeeded', { username });

  const userProfile: UserProfile = {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    forcePasswordReset: user.force_password_reset ?? false,
  };

  // If force_password_reset is true, return a short-lived reset token instead of a session token
  if (user.force_password_reset) {
    const resetToken = jwt.sign(
      {
        sub: user.id,
        username: user.username,
        role: user.role,
      },
      config.jwt.secret,
      { expiresIn: config.auth.resetTokenExpiresIn },
    );

    return {
      requiresPasswordReset: true,
      resetToken,
      user: userProfile,
    };
  }

  // Sign JWT with sub, username, and role claims
  const token = jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );

  return {
    token,
    expiresIn: config.jwt.expiresIn,
    user: userProfile,
  };
}

/**
 * Verify a JWT token's signature and expiry.
 * Returns the decoded TokenPayload on success.
 * Throws on invalid/expired/malformed tokens.
 */
export function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, config.jwt.secret) as TokenPayload;
  return decoded;
}

/**
 * Change a user's password.
 * Validates current password, enforces new password rules, updates DB,
 * clears force_password_reset flag, and returns a fresh JWT.
 * @see Requirements 1.5, 1.6, 1.7, 1.8
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  // Query user by ID to get stored hash
  let result;
  try {
    result = await query<{
      id: string;
      username: string;
      password: string;
      role: 'admin' | 'user';
      display_name: string;
      force_password_reset: boolean;
      created_at: string;
      updated_at: string;
    }>(
      'SELECT id, username, password, role, display_name, force_password_reset, created_at, updated_at FROM users WHERE id = $1',
      [userId],
    );
  } catch (dbError: unknown) {
    console.error('[auth] Database query failed during change-password:', {
      userId,
      error: (dbError as Error).message,
      code: (dbError as any).code,
    });
    const error = new Error('Authentication failed');
    (error as Error & { statusCode: number }).statusCode = 500;
    throw error;
  }

  const user = result.rows[0];

  if (!user) {
    console.warn('[auth] Change-password failed: user not found', { userId });
    throw new Error('Authentication failed');
  }

  // Validate current password against stored hash
  const isCurrentValid = await bcrypt.compare(currentPassword, user.password);
  if (!isCurrentValid) {
    console.warn('[auth] Change-password failed: current password mismatch', { userId, username: user.username });
    const error = new Error('Authentication failed');
    (error as Error & { statusCode: number }).statusCode = 401;
    throw error;
  }

  // Validate new password ≠ current password
  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    const error = new Error('New password must differ from current password');
    (error as Error & { code: string; statusCode: number }).code = 'PASSWORD_SAME';
    (error as Error & { code: string; statusCode: number }).statusCode = 400;
    throw error;
  }

  // Validate new password length ≥ minPasswordLength
  if (newPassword.length < config.auth.minPasswordLength) {
    const error = new Error(`Password must be at least ${config.auth.minPasswordLength} characters`);
    (error as Error & { code: string; statusCode: number }).code = 'PASSWORD_TOO_SHORT';
    (error as Error & { code: string; statusCode: number }).statusCode = 400;
    throw error;
  }

  // Hash new password with bcrypt
  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);

  // Update password in DB and set force_password_reset = false
  const updateResult = await query<{
    id: string;
    username: string;
    role: 'admin' | 'user';
    display_name: string;
    force_password_reset: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE users SET password = $1, force_password_reset = false, updated_at = NOW()
     WHERE id = $2
     RETURNING id, username, role, display_name, force_password_reset, created_at, updated_at`,
    [hashedPassword, userId],
  );

  const updatedUser = updateResult.rows[0];

  console.log('[auth] Change-password succeeded', { userId, username: updatedUser.username });

  // Generate and return a full JWT token with standard expiry
  const token = jwt.sign(
    {
      sub: updatedUser.id,
      username: updatedUser.username,
      role: updatedUser.role,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn },
  );

  const userProfile: UserProfile = {
    id: updatedUser.id,
    username: updatedUser.username,
    role: updatedUser.role,
    displayName: updatedUser.display_name,
    createdAt: updatedUser.created_at,
    updatedAt: updatedUser.updated_at,
    forcePasswordReset: updatedUser.force_password_reset,
  };

  return {
    token,
    expiresIn: config.jwt.expiresIn,
    user: userProfile,
  };
}

/**
 * Create a new user in the Whitelist_DB.
 * Hashes the password with bcrypt before storage.
 * Returns UserProfile (never includes password).
 * Rejects duplicate usernames with a 409 conflict error.
 * @see Requirements 2.1, 2.3
 */
export async function createUser(_admin: TokenPayload, data: CreateUserDto): Promise<UserProfile> {
  // Check for existing username
  const existing = await query(
    'SELECT id FROM users WHERE username = $1',
    [data.username],
  );

  if (existing.rows.length > 0) {
    const error = new Error('Username already exists');
    (error as Error & { code: string }).code = 'USERNAME_EXISTS';
    (error as Error & { statusCode: number }).statusCode = 409;
    throw error;
  }

  // Hash password with bcrypt
  const hashedPassword = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

  // Insert user into Whitelist_DB
  const result = await query<{
    id: string;
    username: string;
    role: 'admin' | 'user';
    display_name: string;
    force_password_reset: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO users (username, password, role, display_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, role, display_name, force_password_reset, created_at, updated_at`,
    [data.username, hashedPassword, data.role, data.displayName],
  );

  const user = result.rows[0];

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    forcePasswordReset: user.force_password_reset ?? true,
  };
}

/**
 * Update an existing user's profile fields (role, displayName, password) in the Whitelist_DB.
 * Looks up user by username (unique identifier).
 * Returns the updated UserProfile (never includes password).
 * @see Requirements 2.2
 */
export async function updateUser(_admin: TokenPayload, username: string, data: UpdateUserDto): Promise<UserProfile> {
  // Build dynamic update query based on provided fields
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (data.role !== undefined) {
    setClauses.push(`role = $${paramIndex}`);
    params.push(data.role);
    paramIndex++;
  }

  if (data.displayName !== undefined) {
    setClauses.push(`display_name = $${paramIndex}`);
    params.push(data.displayName);
    paramIndex++;
  }

  if (data.password !== undefined) {
    const hashedPassword = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);
    setClauses.push(`password = $${paramIndex}`);
    params.push(hashedPassword);
    paramIndex++;
    // Force password reset on next login so the user picks their own password
    setClauses.push(`force_password_reset = TRUE`);
  }

  // Always update the updated_at timestamp
  setClauses.push(`updated_at = NOW()`);

  // Add username as the final parameter for the WHERE clause
  params.push(username);

  const result = await query<{
    id: string;
    username: string;
    role: 'admin' | 'user';
    display_name: string;
    force_password_reset: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE users SET ${setClauses.join(', ')} WHERE username = $${paramIndex}
     RETURNING id, username, role, display_name, force_password_reset, created_at, updated_at`,
    params,
  );

  if (result.rows.length === 0) {
    const error = new Error('User not found');
    (error as Error & { statusCode: number }).statusCode = 404;
    throw error;
  }

  const user = result.rows[0];

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    forcePasswordReset: user.force_password_reset ?? false,
  };
}
