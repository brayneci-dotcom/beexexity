import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock google-auth-library BEFORE importing loginWithGoogle
const mockVerifyIdToken = vi.fn();
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

import { loginWithGoogle } from '../../src/services/auth.service.js';
import { config } from '../../src/config/index.js';

// Mock the database module
vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}));

import { query } from '../../src/config/database.js';
const mockQuery = vi.mocked(query);

// Sample Google payload
const mockGooglePayload = {
  email: 'testuser@gmail.com',
  sub: 'google-sub-12345',
  name: 'Test User',
};

const mockGoogleUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  username: 'testuser@gmail.com',
  role: 'user' as const,
  display_name: 'Test User',
  group_name: null,
  auth_provider: 'google',
  created_at: '2024-01-15T10:00:00.000Z',
  updated_at: '2024-01-15T10:00:00.000Z',
};

describe('Google Auth — loginWithGoogle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should JIT-provision a new user on first-time Google login', async () => {
    // Step 1: Find by google_id → not found
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // Step 2: Find by email → not found
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // Step 3: Insert new user
    mockQuery.mockResolvedValueOnce({ rows: [mockGoogleUser], rowCount: 1 } as any);

    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => mockGooglePayload,
    });

    const result = await loginWithGoogle('valid-google-token');

    expect(result.token).toBeDefined();
    expect(result.user.username).toBe('testuser@gmail.com');
    expect(result.user.authProvider).toBe('google');
    expect(result.user.role).toBe('user');
  });

  it('should find existing user by google_id on returning login', async () => {
    // Step 1: Find by google_id → found
    mockQuery.mockResolvedValueOnce({ rows: [mockGoogleUser], rowCount: 1 } as any);

    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => mockGooglePayload,
    });

    const result = await loginWithGoogle('valid-google-token');

    expect(result.token).toBeDefined();
    expect(result.user.username).toBe('testuser@gmail.com');
    expect(result.user.authProvider).toBe('google');
    // Only one query should have run (find by google_id)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('should link google_id to existing local user by email', async () => {
    const localUser = { ...mockGoogleUser, auth_provider: 'local', google_id: null };

    // Step 1: Find by google_id → not found
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // Step 2: Find by email → found (local user)
    mockQuery.mockResolvedValueOnce({ rows: [localUser], rowCount: 1 } as any);
    // Step 3: UPDATE to link google_id
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as any);

    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => mockGooglePayload,
    });

    const result = await loginWithGoogle('valid-google-token');

    expect(result.token).toBeDefined();
    expect(result.user.username).toBe('testuser@gmail.com');
    expect(result.user.authProvider).toBe('google');
    // Verify the UPDATE query was called with google_id
    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE users SET google_id');
    expect(updateCall[1]).toContain('google-sub-12345');
  });

  it('should reject invalid Google ID token', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Invalid token'));

    await expect(loginWithGoogle('fake-token')).rejects.toThrow('Google authentication failed');
  });

  it('should reject token missing email or sub', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ email: '', sub: '' }),
    });

    await expect(loginWithGoogle('incomplete-token')).rejects.toThrow('Google authentication failed');
  });

  it('should retry on UNIQUE constraint violation (race condition)', async () => {
    const uniqViolation = new Error('duplicate key value violates unique constraint');
    (uniqViolation as any).code = '23505';

    // Attempt 1: find google_id → empty, find email → empty, INSERT → UNIQUE violation
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    mockQuery.mockRejectedValueOnce(uniqViolation);
    // Retry: find google_id → found (concurrent insert completed)
    mockQuery.mockResolvedValueOnce({ rows: [mockGoogleUser], rowCount: 1 } as any);

    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => mockGooglePayload,
    });

    const result = await loginWithGoogle('valid-google-token');

    expect(result.token).toBeDefined();
    expect(result.user.username).toBe('testuser@gmail.com');
    // 4 queries: find google_id, find email, INSERT (fail), retry find google_id
    expect(mockQuery.mock.calls).toHaveLength(4);
  });

  it('should fail after max retries exhausted', async () => {
    const uniqViolation = new Error('duplicate key value violates unique constraint');
    (uniqViolation as any).code = '23505';

    // Step 1: Find by google_id → not found (×3 attempts)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any);
    // All three INSERT attempts fail with UNIQUE violation
    mockQuery.mockRejectedValue(uniqViolation);

    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => mockGooglePayload,
    });

    await expect(loginWithGoogle('valid-google-token')).rejects.toThrow();
  });
});
