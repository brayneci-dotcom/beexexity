import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { login, verifyToken, createUser, updateUser } from '../../src/services/auth.service.js';
import { config } from '../../src/config/index.js';
import { TokenPayload } from '../../src/types/auth.types.js';

// Mock the database module
vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../src/config/database.js';

const mockQuery = vi.mocked(query);

describe('Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    const mockUser = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      username: 'testuser',
      password: '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012', // bcrypt hash
      role: 'user' as const,
      display_name: 'Test User',
      auth_provider: 'local',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    };

    it('should return a signed JWT and user profile on valid credentials', async () => {
      mockQuery.mockResolvedValue({ rows: [mockUser], rowCount: 1 } as never);
      vi.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await login('testuser', 'correctpassword');

      expect(result.token).toBeDefined();
      expect(result.expiresIn).toBe(config.jwt.expiresIn);
      expect(result.user).toEqual({
        id: mockUser.id,
        username: mockUser.username,
        role: mockUser.role,
        displayName: mockUser.display_name,
        createdAt: mockUser.created_at,
        updatedAt: mockUser.updated_at,
        forcePasswordReset: false,
        authProvider: 'local',
      });

      // Verify the JWT contains the correct claims
      const decoded = jwt.verify(result.token, config.jwt.secret) as Record<string, unknown>;
      expect(decoded.sub).toBe(mockUser.id);
      expect(decoded.username).toBe(mockUser.username);
      expect(decoded.role).toBe(mockUser.role);
    });

    it('should throw "Authentication failed" when username does not exist', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

      await expect(login('nonexistent', 'anypassword')).rejects.toThrow('Authentication failed');
    });

    it('should throw "Authentication failed" when password is wrong', async () => {
      mockQuery.mockResolvedValue({ rows: [mockUser], rowCount: 1 } as never);
      vi.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      await expect(login('testuser', 'wrongpassword')).rejects.toThrow('Authentication failed');
    });

    it('should return the same error message whether username or password is wrong (opacity)', async () => {
      // Wrong username
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);
      const usernameError = await login('bad', 'pass').catch((e) => e.message);

      // Wrong password
      mockQuery.mockResolvedValue({ rows: [mockUser], rowCount: 1 } as never);
      vi.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      const passwordError = await login('testuser', 'wrong').catch((e) => e.message);

      expect(usernameError).toBe(passwordError);
      expect(usernameError).toBe('Authentication failed');
    });

    it('should query the database with the username parameter', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

      await login('someuser', 'somepass').catch(() => {});

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE username = $1'),
        ['someuser'],
      );
    });
  });

  describe('verifyToken', () => {
    it('should return decoded payload for a valid token', () => {
      const token = jwt.sign(
        { sub: 'user-id-123', username: 'admin', role: 'admin' },
        config.jwt.secret,
        { expiresIn: 3600 },
      );

      const payload = verifyToken(token);

      expect(payload.sub).toBe('user-id-123');
      expect(payload.username).toBe('admin');
      expect(payload.role).toBe('admin');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it('should throw on an expired token', () => {
      const token = jwt.sign(
        { sub: 'user-id-123', username: 'user', role: 'user' },
        config.jwt.secret,
        { expiresIn: -1 }, // already expired
      );

      expect(() => verifyToken(token)).toThrow();
    });

    it('should throw on a token with an invalid signature', () => {
      const token = jwt.sign(
        { sub: 'user-id-123', username: 'user', role: 'user' },
        'wrong-secret',
        { expiresIn: 3600 },
      );

      expect(() => verifyToken(token)).toThrow();
    });

    it('should throw on a malformed token', () => {
      expect(() => verifyToken('not.a.valid.jwt')).toThrow();
    });
  });

  describe('createUser', () => {
    const adminPayload: TokenPayload = {
      sub: 'admin-id-001',
      username: 'admin',
      role: 'admin',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const mockCreatedUser = {
      id: '660e8400-e29b-41d4-a716-446655440001',
      username: 'newuser',
      role: 'user' as const,
      display_name: 'New User',
      auth_provider: 'local',
      created_at: '2024-01-15T10:00:00.000Z',
      updated_at: '2024-01-15T10:00:00.000Z',
    };

    it('should create a user and return UserProfile without password', async () => {
      // First call: check for existing username (none found)
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
      // Second call: insert user
      mockQuery.mockResolvedValueOnce({ rows: [mockCreatedUser], rowCount: 1 } as never);
      vi.spyOn(bcrypt, 'hash').mockResolvedValue('$2b$12$hashedpassword' as never);

      const result = await createUser(adminPayload, {
        username: 'newuser',
        password: 'securepass123',
        role: 'user',
        displayName: 'New User',
      });

      expect(result).toEqual({
        id: mockCreatedUser.id,
        username: mockCreatedUser.username,
        role: mockCreatedUser.role,
        displayName: mockCreatedUser.display_name,
        createdAt: mockCreatedUser.created_at,
        updatedAt: mockCreatedUser.updated_at,
        forcePasswordReset: true,
        authProvider: 'local',
      });
      // Ensure password is not in the result
      expect(result).not.toHaveProperty('password');
    });

    it('should hash the password with bcrypt before storing', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
      mockQuery.mockResolvedValueOnce({ rows: [mockCreatedUser], rowCount: 1 } as never);
      const hashSpy = vi.spyOn(bcrypt, 'hash').mockResolvedValue('$2b$12$hashed' as never);

      await createUser(adminPayload, {
        username: 'newuser',
        password: 'mypassword',
        role: 'user',
        displayName: 'New User',
      });

      expect(hashSpy).toHaveBeenCalledWith('mypassword', 12);
    });

    it('should throw 409 conflict error for duplicate username', async () => {
      // Simulate existing username found
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }], rowCount: 1 } as never);

      try {
        await createUser(adminPayload, {
          username: 'existinguser',
          password: 'pass',
          role: 'user',
          displayName: 'Dup User',
        });
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        const err = error as Error & { code?: string; statusCode?: number };
        expect(err.message).toBe('Username already exists');
        expect(err.code).toBe('USERNAME_EXISTS');
        expect(err.statusCode).toBe(409);
      }
    });

    it('should insert the user with hashed password into the database', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
      mockQuery.mockResolvedValueOnce({ rows: [mockCreatedUser], rowCount: 1 } as never);
      vi.spyOn(bcrypt, 'hash').mockResolvedValue('$2b$12$thehash' as never);

      await createUser(adminPayload, {
        username: 'newuser',
        password: 'pass123',
        role: 'user',
        displayName: 'New User',
      });

      // Verify the INSERT query was called with the hashed password
      expect(mockQuery).toHaveBeenCalledTimes(2);
      const insertCall = mockQuery.mock.calls[1];
      expect(insertCall[0]).toContain('INSERT INTO users');
      expect(insertCall[1]).toEqual(['newuser', '$2b$12$thehash', 'user', 'New User', null]);
    });
  });

  describe('updateUser', () => {
    const adminPayload: TokenPayload = {
      sub: 'admin-id-001',
      username: 'admin',
      role: 'admin',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    const mockUpdatedUser = {
      id: '660e8400-e29b-41d4-a716-446655440001',
      username: 'existinguser',
      role: 'admin' as const,
      display_name: 'Updated Name',
      auth_provider: 'local',
      created_at: '2024-01-10T10:00:00.000Z',
      updated_at: '2024-01-16T12:00:00.000Z',
    };

    it('should update user role and return UserProfile without password', async () => {
      mockQuery.mockResolvedValue({ rows: [mockUpdatedUser], rowCount: 1 } as never);

      const result = await updateUser(adminPayload, mockUpdatedUser.id, { role: 'admin' });

      expect(result).toEqual({
        id: mockUpdatedUser.id,
        username: mockUpdatedUser.username,
        role: 'admin',
        displayName: mockUpdatedUser.display_name,
        createdAt: mockUpdatedUser.created_at,
        updatedAt: mockUpdatedUser.updated_at,
        forcePasswordReset: false,
        authProvider: 'local',
      });
      expect(result).not.toHaveProperty('password');
    });

    it('should update displayName', async () => {
      mockQuery.mockResolvedValue({ rows: [mockUpdatedUser], rowCount: 1 } as never);

      const result = await updateUser(adminPayload, mockUpdatedUser.id, { displayName: 'Updated Name' });

      expect(result.displayName).toBe('Updated Name');
    });

    it('should throw 404 when user is not found', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

      try {
        await updateUser(adminPayload, 'non-existent-id', { role: 'admin' });
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        const err = error as Error & { statusCode?: number };
        expect(err.message).toBe('User not found');
        expect(err.statusCode).toBe(404);
      }
    });

    it('should build dynamic UPDATE query with only provided fields', async () => {
      mockQuery.mockResolvedValue({ rows: [mockUpdatedUser], rowCount: 1 } as never);

      await updateUser(adminPayload, 'some-user-id', { role: 'admin', displayName: 'New Name' });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET'),
        ['admin', 'New Name', 'some-user-id'],
      );
    });
  });
});
