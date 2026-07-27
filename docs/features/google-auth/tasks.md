# Google OAuth Authentication — Tasks

**Traceability:** Each task links to a requirement from `docs/google-auth.md`.

---

## Wave 1: Schema & Config

- [ ] **[Req 4.1]** Create `migrations/011_google_oauth.sql`
  - `ALTER COLUMN password DROP NOT NULL`
  - `ADD COLUMN google_id VARCHAR(255) UNIQUE`
  - `ADD COLUMN auth_provider VARCHAR(16) NOT NULL DEFAULT 'local'`
  - `CREATE INDEX idx_users_google_id ON users (google_id) WHERE google_id IS NOT NULL`
  - Run migration locally to verify

- [ ] **[Req 5.3]** Add `GOOGLE_CLIENT_ID` to `src/config/index.ts`
  - `google: { clientId: process.env.GOOGLE_CLIENT_ID || '' }`

- [ ] **[Req 7]** Add `GOOGLE_CLIENT_ID` to `cloudbuild.yaml` env vars

## Wave 2: Backend Auth Service

- [ ] **[Req 4.2]** Add `loginWithGoogle()` to `src/services/auth.service.ts`
  - Install `google-auth-library`
  - Verify Google ID token: `OAuth2Client.verifyIdToken({ idToken, audience: clientId })`
  - Extract `email`, `sub` (google_id), `name` from verified payload
  - JIT logic with max 3 retries (race condition guard):
    1. Find by `google_id` → login
    2. Find by `username = email` → update `google_id`, set `auth_provider = 'google'` → login
    3. Not found → INSERT with `google_id`, `username = email`, `auth_provider = 'google'`, `password = NULL` → login
    4. If step 3 hits UNIQUE violation → retry from step 1 (max 3 attempts)
  - Include `authProvider` in JWT claims

- [ ] **[Req 5.3]** Guard existing `login()` against NULL password
  - If `user.auth_provider === 'google'` → throw with "This account uses Google Sign-In"
  - Prevents `bcrypt.compare()` from crashing on NULL

## Wave 3: Route

- [ ] **[Req 4.2]** Add `POST /auth/google` to `src/routes/auth.routes.ts`
  - Accept `{ credential: string }` in body
  - Call `loginWithGoogle(credential)`
  - Return `{ token, user }` — same shape as `POST /auth/login`
  - Handle errors: `GOOGLE_AUTH_FAILED`, missing credential

## Wave 4: Frontend

- [ ] **[Req 4.3]** Add Google Sign-In button to `public/index.html` login screen
  - Load GIS script: `<script src="https://accounts.google.com/gsi/client" async>`
  - Render Google button in `.login-box` below the password field
  - GIS callback: capture `credential` → POST to `/auth/google` → receive JWT → proceed through existing login flow

- [ ] **[Req 4.3]** Frontend conditional UI for Google users
  - `authProvider` comes from login response `user.authProvider` (not JWT decoding)
  - Store `authProvider` in `sessionStorage` alongside `admin_role` after login
  - If `authProvider === 'google'`: hide "Change Password", hide "Forgot Password"
  - If `authProvider === 'local'`: show as before (no change)

## Wave 5: Tests

- [ ] **[Req 8]** Write `tests/unit/auth-google.test.ts`
  - Mock `google-auth-library` `verifyIdToken()`
  - Test JIT provisioning: first-time Google user creates record
  - Test returning Google user: finds by google_id
  - Test email match: existing local user gets linked
  - Test invalid token: throws error
  - Test NULL password guard: Google user trying local login gets clear error

---

## Checkpoints

- [ ] **Checkpoint — `npm run build` passes** (after Wave 1)
- [ ] **Checkpoint — `npm test` passes** (after Wave 5)
- [ ] **Checkpoint — Manual verify:** Google login flow end-to-end (requires Google OAuth client configured)
- [ ] **Checkpoint — Manual verify:** Existing local login still works (regression)
- [ ] **Checkpoint — Manual verify:** Change Password hidden for Google users
