# Implementation Plan: Unified Inference Gateway

## Overview

This implementation plan breaks the Unified Inference Gateway into incremental coding tasks. The approach starts with project scaffolding and shared types, then builds out each service layer (auth, PII masking, inference, audit, cost), followed by API wiring, and finally integration tests. Each task builds on prior work so there is no orphaned code.

## Tasks

- [x] 1. Project setup and core interfaces
  - [x] 1.1 Initialize Node.js/TypeScript project with Express, configure tsconfig, eslint, and install dependencies
    - Initialize `package.json` with TypeScript, Express, `@aws-sdk/client-bedrock-runtime`, `jsonwebtoken`, `bcrypt`, `pg`, `uuid`, and dev deps (`vitest`, `fast-check`, `@types/*`)
    - Create `tsconfig.json` with strict mode, ES2022 target, NodeNext module resolution
    - Create base directory structure: `src/services`, `src/middleware`, `src/routes`, `src/types`, `src/config`, `src/frontend`, `tests/unit`, `tests/property`, `tests/integration`
    - _Requirements: 7.1 (ap-southeast-3 region config)_

  - [x] 1.2 Define shared TypeScript interfaces and types
    - Create `src/types/auth.types.ts` — `LoginResult`, `TokenPayload`, `UserProfile`, `CreateUserDto`, `UpdateUserDto`
    - Create `src/types/pii.types.ts` — `MaskResult`, `DetectedEntity`, `PIIEntityType`
    - Create `src/types/inference.types.ts` — `InferenceRequest`, `InferenceResult`, `ALLOWED_MODELS`, `DEFAULT_MODEL`
    - Create `src/types/audit.types.ts` — `AuditEntry`
    - Create `src/types/pricing.types.ts` — `PricingConfig`, `ModelPricing`, `SessionCostState`, `RequestCost`
    - Create `src/types/error.types.ts` — Standard error response interface `{ error: string, message: string }`
    - _Requirements: 5.1, 5.2, 6.2_

  - [x] 1.3 Create database schema migration file and connection pool setup
    - Create `src/config/database.ts` with PostgreSQL connection pool (pg `Pool`) configured for ap-southeast-3 RDS
    - Create `migrations/001_initial_schema.sql` with `users` and `audit_logs` tables as defined in design
    - Include indices on `users.username`, `audit_logs.timestamp`, `audit_logs.user_id`
    - _Requirements: 7.2, 8.3_

  - [x] 1.4 Create Pricing_Config JSON file
    - Create `src/frontend/pricing-config.json` with all 5 model pricing entries as defined in design
    - Include `currency: "USD"` and `lastUpdated` field
    - _Requirements: 9.1_

- [x] 2. Authentication service and middleware
  - [x] 2.1 Implement Auth Service — login and token management
    - Create `src/services/auth.service.ts`
    - Implement `login(username, password)` — validate credentials against Whitelist_DB using bcrypt compare, return signed JWT with `sub`, `username`, `role` claims
    - Implement `verifyToken(token)` — verify JWT signature and expiry, return `TokenPayload`
    - JWT expiry should be configurable via environment variable (default 3600s)
    - On invalid credentials, return generic "Authentication failed" error without revealing which field was wrong
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 2.2 Write property tests for Auth Service (Properties 1, 2)
    - **Property 1: JWT Claims Correctness** — For any valid user record, after login the decoded JWT contains matching `sub`, `username`, and `role`
    - **Property 2: Auth Error Opacity** — For any invalid credential combo, the error response is identical regardless of which credential was wrong
    - **Validates: Requirements 1.1, 1.2**

  - [x] 2.3 Implement Auth Middleware — JWT validation on protected routes
    - Create `src/middleware/auth.middleware.ts`
    - Extract Bearer token from Authorization header
    - Validate signature and expiry using `auth.service.verifyToken()`
    - Attach decoded `TokenPayload` to `req.user`
    - Return 401 with descriptive message for missing, expired, or tampered tokens
    - _Requirements: 1.4, 1.5_

  - [x] 2.4 Implement Admin Role Guard middleware
    - Create `src/middleware/admin.middleware.ts`
    - Check `req.user.role === 'admin'`, reject with 403 if not
    - _Requirements: 2.4_

  - [ ]* 2.5 Write property tests for Auth Middleware and Role Guard (Properties 3, 5)
    - **Property 3: JWT Validation Correctness** — Middleware accepts token iff valid signature AND not expired; rejects tampered/expired/malformed tokens with 401
    - **Property 5: Admin-Only Access Enforcement** — Non-admin users always get 403 on admin endpoints regardless of payload
    - **Validates: Requirements 1.4, 1.5, 2.4**

  - [x] 2.6 Implement User Management — create and update users
    - Add `createUser(admin, data)` and `updateUser(admin, userId, data)` to Auth Service
    - Hash password with bcrypt on creation
    - Return `UserProfile` (never include password)
    - Reject duplicate usernames with 409 conflict error
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 2.7 Write property test for User Profile Password Exclusion (Property 4)
    - **Property 4: User Profile Password Exclusion** — For any user creation, the returned object never contains password or password-derived data
    - **Validates: Requirements 2.1**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. PII Masker service
  - [x] 4.1 Implement PII detection with regex patterns
    - Create `src/services/pii-masker.service.ts`
    - Implement regex detectors for NIK (16-digit with province code validation), NO_REKENING (8-15 digits in banking context), NO_HP (Indonesian mobile formats: +62/62/08 + 8-12 digits)
    - Implement dictionary-based detection for NAMA_BANK (curated list of Indonesian banks with fuzzy matching)
    - _Requirements: 3.1, 3.2_

  - [x] 4.2 Implement NER-based name detection and masking logic
    - Add person name detection (NAMA entity type) — use NER approach or pattern-based heuristic for Indonesian names
    - Implement the masking function: replace each detected entity with type-specific placeholder tokens (`[NIK]`, `[NO_REKENING]`, `[NO_HP]`, `[NAMA]`, `[NAMA_BANK]`)
    - Assign uniquely indexed placeholders for multiple same-type entities: `[NAMA_1]`, `[NAMA_2]`, etc.
    - Return `MaskResult` with `maskedText`, `detectedEntities` array, and `entityCount`
    - If no PII detected, return text unchanged with empty entities array
    - _Requirements: 3.3, 3.4, 4.1, 4.2, 4.3, 4.4_

  - [ ]* 4.3 Write property tests for PII Masker (Properties 6, 7, 8, 9)
    - **Property 6: PII Detection and Masking Completeness** — All PII entities in input are replaced, no original PII text remains in output
    - **Property 7: Unique Indexed Placeholder Assignment** — N same-type entities get `[TYPE_1]` through `[TYPE_N]` with no gaps or duplicates
    - **Property 8: No-PII Passthrough Identity** — Text without PII passes through unchanged
    - **Property 9: Masking Preserves Surrounding Structure** — Only PII positions change; all surrounding characters remain identical
    - **Validates: Requirements 3.1, 3.3, 3.4, 4.1, 4.3**

  - [ ]* 4.4 Write unit tests for PII regex patterns
    - Test specific NIK formats (valid 16-digit with correct province codes, invalid lengths)
    - Test Indonesian phone number variants (+62812xxx, 0812xxx, 62812xxx)
    - Test bank account number detection in context
    - Test bank name dictionary matching
    - _Requirements: 3.1, 3.2_

- [x] 5. Inference service and streaming
  - [x] 5.1 Implement model validation logic
    - Create `src/services/inference.service.ts`
    - Implement model validation against `ALLOWED_MODELS` array
    - Default to `qwen.qwen3-32b-v1:0` when modelId is not specified
    - Reject invalid modelId with 400 error listing allowed models
    - _Requirements: 5.3, 5.4, 5.5_

  - [ ]* 5.2 Write property test for Model Validation (Property 10)
    - **Property 10: Model Validation** — Gateway accepts model_id iff it is in the 5 allowed models; rejects all others
    - **Validates: Requirements 5.3, 5.5, 6.2**

  - [x] 5.3 Implement Bedrock ConverseStream integration with SSE output
    - Configure `BedrockRuntimeClient` with `region: 'ap-southeast-3'`
    - Implement `generate()` method using `ConverseStreamCommand`
    - Map Bedrock stream events to SSE events: `contentBlockDelta` → `event: delta`, `metadata` → `event: metadata`, `messageStop` → `event: done`
    - Extract `inputTokens` and `outputTokens` from metadata event
    - Return `InferenceResult` with token counts and status
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 5.4 Implement retry logic with exponential backoff
    - Retry only on `ThrottlingException` (HTTP 429)
    - Exponential backoff: `delay = 1000ms × 2^attempt` (max 3 attempts)
    - No retry on timeouts or model errors
    - After exhausted retries, return sanitized error message (no AWS internals)
    - _Requirements: 6.4, 6.5, 6.6_

  - [ ]* 5.5 Write property tests for Retry Logic and Error Sanitization (Properties 11, 12)
    - **Property 11: Retry Logic with Exponential Backoff** — For K throttling errors (1≤K≤3), exactly K retries with exponential delays, never exceeds 3 attempts
    - **Property 12: Error Message Sanitization** — User-facing errors never contain AWS ARNs, request IDs, or stack traces
    - **Validates: Requirements 6.4, 6.5**

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Audit logging service
  - [x] 7.1 Implement Audit Logger — async metadata persistence
    - Create `src/services/audit.service.ts`
    - Implement `log(entry: AuditEntry)` — insert record into `audit_logs` table
    - Fire-and-forget pattern: never block the inference response
    - Record: timestamp, userId, username, modelId, inputTokens, outputTokens, status, errorCategory, durationMs
    - Never store prompt text or response text
    - On failed requests, record error category (throttling, timeout, model_error)
    - Graceful degradation: if DB insert fails, log error to console but don't crash
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 7.2 Write property test for Audit Entry (Property 13)
    - **Property 13: Audit Entry Completeness and Content Exclusion** — Every audit entry has all required metadata fields AND never contains prompt/response text
    - **Validates: Requirements 8.1, 8.2, 8.4**

- [x] 8. Frontend cost display module
  - [x] 8.1 Implement cost calculator and session state management
    - Create `src/frontend/cost-display.ts`
    - Implement cost calculation: `cost = (inputTokens × inputRate + outputTokens × outputRate) / 1_000_000`
    - Implement `SessionCostState` tracking: array of `RequestCost` entries, running session total
    - On model switch, continue accumulating additively — do not recalculate past requests at new rate
    - Handle missing Pricing_Config gracefully: show token counts without cost, display warning
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.7_

  - [ ]* 8.2 Write property test for Cost Calculation (Property 14)
    - **Property 14: Cost Calculation and Session Accumulation** — Each request cost uses its own model's rate; session total equals sum of individual costs; model switches don't recalculate past costs
    - **Validates: Requirements 9.3, 9.4, 9.5**

  - [ ]* 8.3 Write unit tests for cost display edge cases
    - Test zero token counts
    - Test Pricing_Config unavailable scenario
    - Test session total accumulation across multiple models
    - _Requirements: 9.4, 9.7_

- [x] 9. API routes and Express wiring
  - [x] 9.1 Implement auth routes — POST /api/v1/auth/login
    - Create `src/routes/auth.routes.ts`
    - Wire login endpoint to Auth Service
    - Validate request body (username, password required)
    - Return JWT and user profile on success, 401 on failure
    - _Requirements: 1.1, 1.2_

  - [x] 9.2 Implement admin routes — POST /api/v1/admin/users, PUT /api/v1/admin/users/:id
    - Create `src/routes/admin.routes.ts`
    - Apply auth middleware + admin guard
    - Wire create user and update user to Auth Service
    - Validate request bodies, return appropriate status codes (201, 200, 409, 403)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 9.3 Implement models route — GET /api/v1/models
    - Create `src/routes/models.routes.ts`
    - Apply auth middleware
    - Return list of available models with display names and pricing info
    - Mark default model in response
    - _Requirements: 5.1, 5.2_

  - [x] 9.4 Implement inference route — POST /api/v1/inference/generate (SSE)
    - Create `src/routes/inference.routes.ts`
    - Apply auth middleware
    - Validate prompt (non-empty) and modelId (optional, default to qwen.qwen3-32b-v1:0)
    - Call PII Masker → Inference Service (SSE stream) → Audit Logger
    - Set response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
    - Handle SSE event formatting for delta, metadata, done, and error events
    - _Requirements: 4.2, 5.3, 5.4, 6.1, 6.3, 8.1_

  - [x] 9.5 Create Express app entry point with middleware stack and error handling
    - Create `src/app.ts` — Express app with JSON body parser, CORS, route mounting
    - Create `src/server.ts` — HTTP server startup on configurable port
    - Mount routes: `/api/v1/auth`, `/api/v1/admin`, `/api/v1/models`, `/api/v1/inference`
    - Add global error handler with standard error format `{ error, message }`
    - Ensure no internal details leak in error responses
    - _Requirements: 6.5, 7.5_

- [x] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Integration tests and final wiring
  - [ ]* 11.1 Write integration tests for auth flow
    - Test full login flow → JWT → protected endpoint access
    - Test expired token rejection
    - Test admin route access control
    - _Requirements: 1.1, 1.4, 1.5, 2.4_

  - [ ]* 11.2 Write integration tests for inference flow
    - Test full request flow: auth → PII masking → inference → SSE streaming → audit logging
    - Mock Bedrock client for controlled responses
    - Verify SSE event format (delta, metadata, done)
    - Verify audit log entry created after completion
    - _Requirements: 4.2, 6.1, 6.3, 8.1_

  - [ ]* 11.3 Write integration tests for error handling and retry
    - Test throttling retry behavior with mocked Bedrock errors
    - Test timeout error handling (no retry)
    - Test invalid model rejection
    - Test PII masker fail-closed behavior (reject on masker error)
    - _Requirements: 6.4, 6.5, 6.6_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (14 properties total)
- Unit tests validate specific examples and edge cases
- The PII masker uses a hybrid approach: regex for structured patterns, NER/heuristics for names
- Bedrock client is hardcoded to ap-southeast-3 — no cross-region fallback by design
- Audit logging is fire-and-forget to avoid blocking inference responses
- Cost calculation is frontend-only — no server-side billing logic needed

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.6", "4.2"] },
    { "id": 4, "tasks": ["2.4", "2.5", "2.7", "4.3", "4.4"] },
    { "id": 5, "tasks": ["5.1", "7.1", "8.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "7.2", "8.2", "8.3"] },
    { "id": 7, "tasks": ["5.4"] },
    { "id": 8, "tasks": ["5.5", "9.1", "9.2", "9.3"] },
    { "id": 9, "tasks": ["9.4"] },
    { "id": 10, "tasks": ["9.5"] },
    { "id": 11, "tasks": ["11.1", "11.2", "11.3"] }
  ]
}
```
