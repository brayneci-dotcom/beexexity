# Google OAuth Authentication — Design

## Overview

Add Google Account sign-in via OpenID Connect. Users authenticate with Google, backend verifies the ID token, and issues the same HS256 JWT the app already uses. No changes to `auth.middleware.ts` or existing session/inference flows.

## Key Decisions (Lazy/YAGNI)

- **Skip account linking in v1.** The requirement describes linking Google accounts to existing local users. This adds branching logic for a rare edge case. v1 only handles: (a) first-time Google login → JIT provision, (b) returning Google login → find by `google_id`, (c) new user whose email matches existing local user → update record. Account linking (explicit "Connect Google Account" from settings) can be v2.
- **`authProvider` in login response + JWT claims.** Embed `authProvider` in the JWT for server-side use (future middleware checks). For the frontend, include `authProvider` in the login response `user` object — the frontend already reads `user.role` from the response, so reading `user.authProvider` is zero new work. Stored in `sessionStorage` alongside `admin_role`.
- **Reuse existing `login()` response shape.** The Google endpoint returns the same `{ token, user }` shape as `POST /auth/login`. The frontend handles both identically. Only difference: JWT includes `authProvider: 'google'`.
- **Handle NULL password in existing `login()`.** When `password` is nullable, the existing `bcrypt.compare(password, user.password)` would throw if `user.password` is NULL. Add a guard: if `auth_provider = 'google'`, throw "Account is linked to Google. Sign in with Google instead."
- **No frontend router changes.** The Google sign-in button is added to the existing login screen. The GIS callback captures the credential, sends it to the backend, gets back a JWT, and proceeds through the existing login flow (fetch models → load sessions → show chat).

## Architecture

```
Login Screen
  ├─ Local: username/password → POST /auth/login → existing flow
  └─ Google: GIS button → credential → POST /auth/google
       ↓
  auth.routes.ts → auth.service.ts (verify Google token)
       ↓
  JIT logic:
    1. Find by google_id → found? → login
    2. Find by username (email) → found? → link google_id → login
    3. Not found? → INSERT new user → login
       ↓
  Standard HS256 JWT + user profile (includes authProvider)
       ↓
  Frontend stores JWT, decodes authProvider from payload → conditionally hides password UI
```

## Components & Interfaces

### New/Modified Files

| File | Action | Purpose |
|------|--------|---------|
| `migrations/011_google_oauth.sql` | **New** | ALTER users: password nullable, add google_id, auth_provider |
| `src/config/index.ts` | Modify | Add `google.clientId` from `GOOGLE_CLIENT_ID` env var |
| `src/services/auth.service.ts` | Modify | Add `loginWithGoogle()` function |
| `src/routes/auth.routes.ts` | Modify | Add `POST /auth/google` route |
| `public/index.html` | Modify | Add GIS script + Google Sign-In button to login screen |
| `src/frontend/cost-display.ts` | No change | — |
| `src/middleware/auth.middleware.ts` | **No change** | JWT validation untouched |
| `cloudbuild.yaml` | Modify | Inject `GOOGLE_CLIENT_ID` env var |

### Key Interfaces

```typescript
// auth.service.ts — new
interface GoogleLoginResult extends LoginResult {
  authProvider: 'google' | 'local';
}

async function loginWithGoogle(credential: string): Promise<GoogleLoginResult> {
  // 1. Verify Google ID token with google-auth-library
  // 2. JIT provisioning logic (find/link/create)
  // 3. Return standard JWT + user
}
```

### Configuration

```typescript
// config/index.ts addition
google: {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
}
```

### JWT Payload

```typescript
// Existing payload, add authProvider field
{
  sub: string,          // user.id
  username: string,     // user.username (email)
  role: string,         // 'admin' | 'user'
  authProvider: string, // 'local' | 'google'  ← NEW (JWT + API response)
  iat: number,
  exp: number,
}
```

### Login Response Shape

```typescript
// POST /auth/google response (same shape as POST /auth/login)
{
  token: string,         // HS256 JWT
  user: {
    id: string,
    username: string,
    role: string,
    authProvider: 'google' | 'local',  // ← NEW
    displayName?: string,
  },
}
```

Frontend reads `data.user.authProvider` and stores in `sessionStorage` alongside `admin_role`. No JWT decoding needed on the frontend.

## Data Models

### Migration 011: Google OAuth

```sql
-- Make password nullable for Google-only users
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;

-- Add Google OIDC subject identifier (unique)
ALTER TABLE users ADD COLUMN google_id VARCHAR(255) UNIQUE;

-- Add auth provider discriminator
ALTER TABLE users ADD COLUMN auth_provider VARCHAR(16) NOT NULL DEFAULT 'local';

-- Index for google_id lookups
CREATE INDEX idx_users_google_id ON users (google_id) WHERE google_id IS NOT NULL;
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Google token verification fails | Return 401 `GOOGLE_AUTH_FAILED` — "Google authentication failed" |
| Google API unreachable | Return 502 with clear error message, don't crash server |
| NULL password + local login attempt | Return 401 with message "This account uses Google Sign-In" |
| Duplicate google_id (race condition) | UNIQUE constraint handles it, retry READ after INSERT. Max 3 retries — prevents infinite loop if DB is stuck |
| GOOGLE_CLIENT_ID not configured | Return 500 on startup check — fail closed |

## Testing Strategy

- Unit test: `loginWithGoogle()` with mocked `google-auth-library`
  - Valid token → returns JWT
  - Invalid token → throws
  - First-time user → creates record
  - Returning user → finds by google_id
  - Email match → links account
- Test NULL password guard in existing `login()`
- Test JWT includes `authProvider` claim
