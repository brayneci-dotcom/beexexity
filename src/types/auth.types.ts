/**
 * Authentication and user management types.
 * @see Requirements 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 2.3
 */

export interface LoginResult {
  token?: string;                    // Only present when no reset required
  expiresIn?: number;
  user: UserProfile;
  requiresPasswordReset?: boolean;   // true when First_Login_Flag is set
  resetToken?: string;               // Short-lived token for password change only
}

export interface TokenPayload {
  sub: string;       // user ID
  username: string;
  role: 'admin' | 'user';
  iat: number;
  exp: number;
}

export interface UserProfile {
  id: string;
  username: string;
  role: 'admin' | 'user';
  displayName: string;
  createdAt: string;
  updatedAt: string;
  forcePasswordReset: boolean;       // Exposed to client
}

export interface CreateUserDto {
  username: string;
  password: string;
  role: 'admin' | 'user';
  displayName: string;
}

export interface UpdateUserDto {
  role?: 'admin' | 'user';
  displayName?: string;
  password?: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResult {
  token: string;
  expiresIn: number;
  user: UserProfile;
}
