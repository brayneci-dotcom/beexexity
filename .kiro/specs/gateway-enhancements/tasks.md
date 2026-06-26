# Implementation Plan: Gateway Enhancements

## Overview

This plan implements four areas of enhancement: (1) force password reset on first login, (2) UI overhaul to beexexity dark theme, (3) removal of DeepSeek V3, and (4) a routing engine with prompt refinement, complexity scoring, and policy-based model selection. Tasks are ordered infrastructure-first (types, config, migrations), then services, then route integration, then frontend.

## Tasks

- [x] 1. Infrastructure: Types, Configuration, and Database Migration
  - [x] 1.1 Update inference types to remove DeepSeek V3 and add routing types
    - Remove `deepseek.v3-v1:0` from the `ALLOWED_MODELS` array in `src/types/inference.types.ts`
    - Add `AllowedModelId` type alias
    - Add `RoutingMetadataEvent` interface with fields: `refinedPrompt`, `complexityScore`, `scoreBand`, `routingState`, `executedModelId`, `routingReasonCode`, `reasoningSummary`, `modalityFlags`, `manualOverrideApplied`
    - _Requirements: 3.1, 3.2, 11.1_

  - [x] 1.2 Extend auth types for password reset flow
    - Add `forcePasswordReset` boolean to `UserProfile` interface in `src/types/auth.types.ts`
    - Add `requiresPasswordReset` and `resetToken` optional fields to `LoginResult`
    - Add `ChangePasswordDto` and `ChangePasswordResult` interfaces
    - _Requirements: 1.2, 1.4, 1.5_

  - [x] 1.3 Remove DeepSeek V3 from model capabilities registry
    - Remove the `deepseek.v3-v1:0` entry from `MODEL_CAPABILITIES` in `src/config/model-capabilities.ts`
    - _Requirements: 3.2_

  - [x] 1.4 Extend application configuration for routing and auth
    - Add `routing` section to `src/config/index.ts` with: `longContextThreshold`, `scoringTimeoutMs`, `refinementTimeoutMs`, `defaultFallbackScore`, `metadataEnabled`, `transparencyEnabled`, `scoringModelId`
    - Add `auth` section with: `minPasswordLength`, `resetTokenExpiresIn`
    - _Requirements: 9.2, 10.5, 1.7_

  - [x] 1.5 Create database migration for gateway enhancements
    - Create `migrations/003_gateway_enhancements.sql`
    - Add `force_password_reset BOOLEAN NOT NULL DEFAULT TRUE` column to `users` table
    - Update existing users to `force_password_reset = FALSE`
    - Add routing metadata columns to `audit_logs`: `routing_state`, `complexity_score`, `routing_reason_code`, `reasoning_summary`, `executed_model_id`, `manual_override_applied`, `modality_flags`, `routing_flags`
    - Add indexes on `routing_state` and `complexity_score`
    - _Requirements: 1.1, 10.4_

  - [x] 1.6 Create routing engine types and interfaces
    - Create `src/types/routing.types.ts` with `RoutingInput`, `RoutingDecision`, `ModalityFlags`, `RoutingEngineConfig`, `PolicyInput`, `PolicyResult` interfaces
    - _Requirements: 4.1, 5.1, 5.4, 6.1, 8.4, 10.1_

- [x] 2. Implement Force Password Reset Service Logic
  - [x] 2.1 Extend auth service with password change and reset-aware login
    - Modify `login()` in `src/services/auth.service.ts` to check `force_password_reset` flag and return `requiresPasswordReset: true` with a short-lived reset token instead of a session token when flag is set
    - Implement `changePassword(userId, currentPassword, newPassword)` function that validates current password, checks new ≠ current, checks min length ≥ 8, hashes new password, updates DB, sets `force_password_reset = false`, returns valid JWT
    - Modify `createUser()` to ensure new users get `force_password_reset = true`
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ]* 2.2 Write property tests for password validation logic
    - **Property 5: Password validation rejects invalid inputs**
    - **Validates: Requirements 1.6, 1.7**

  - [ ]* 2.3 Write property tests for password reset login behavior
    - **Property 2: Login with reset flag returns reset-required response**
    - **Property 4: Valid password change round-trip**
    - **Validates: Requirements 1.2, 1.5**

  - [x] 2.4 Create force password reset middleware
    - Create `src/middleware/password-reset.middleware.ts`
    - Middleware checks if `req.user` has `forcePasswordReset = true`
    - If true and route is NOT `/auth/change-password`, respond with HTTP 403 and `PASSWORD_RESET_REQUIRED` error
    - _Requirements: 1.3_

  - [ ]* 2.5 Write property test for force password reset middleware
    - **Property 3: Force password reset blocks protected API access**
    - **Validates: Requirements 1.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Routing Policy Module
  - [x] 4.1 Create routing policy service
    - Create `src/services/routing-policy.service.ts`
    - Implement `applyTextPolicy(score)`: score 1-3 → `qwen.qwen3-32b-v1:0`, score 4 → `nvidia.nemotron-super-3-120b`, score 5 → `qwen.qwen3-235b-a22b-2507-v1:0`
    - Implement `applyVisionPolicy(score)`: select from vision-capable models only (apply complexity within vision models)
    - Implement `applyLongContextPolicy()`: prefer `nvidia.nemotron-super-3-120b` with reason code `long-context`
    - Implement `resolvePolicy(input: PolicyInput)`: top-level dispatcher that checks manual state, long-context, vision, then text policy
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 9.1, 9.3_

  - [ ]* 4.2 Write property tests for text-only routing policy
    - **Property 15: Text-only auto routing follows complexity band policy**
    - **Validates: Requirements 7.2, 7.3, 7.4**

  - [ ]* 4.3 Write property tests for vision and multimodal routing
    - **Property 16: Image presence forces vision-capable model**
    - **Property 17: Manual incompatible model with images is rejected**
    - **Property 18: Documents without images use text routing**
    - **Validates: Requirements 8.1, 8.2, 8.3**

  - [ ]* 4.4 Write property tests for long-context and manual override routing
    - **Property 19: Long context overrides to nemotron with reason code**
    - **Property 20: Manual state overrides long-context preference**
    - **Validates: Requirements 9.1, 9.3, 9.4**

  - [ ]* 4.5 Write property test for DeepSeek V3 exclusion
    - **Property 7: Routing never selects DeepSeek V3**
    - **Validates: Requirements 3.5**

- [x] 5. Implement Routing Engine Service
  - [x] 5.1 Create routing engine service with prompt refinement and complexity scoring
    - Create `src/services/routing-engine.service.ts`
    - Implement `refinePrompt(originalPrompt, documentContext?)`: calls `qwen.qwen3-32b-v1:0` via Bedrock Converse (non-streaming) with `AbortController` timeout (`refinementTimeoutMs`); returns refined prompt or null on failure
    - Implement `scoreComplexity(prompt, documentContext?)`: calls `qwen.qwen3-32b-v1:0` via Bedrock Converse (non-streaming) with `AbortController` timeout (`scoringTimeoutMs`); returns `{ score, confidence }` or null on failure
    - Implement `routeRequest(input: RoutingInput)`: orchestrates refinement → scoring → policy resolution → builds `RoutingDecision` with reasoning summary, modality flags, reason codes
    - Handle all fallback cases: refinement failure → use original prompt + flag, scoring failure → default score 2, policy failure → fallback to default model
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.5, 6.1, 6.2, 6.3, 10.1, 10.2, 12.1, 12.2, 12.3, 12.4_

  - [ ]* 5.2 Write property tests for routing engine fallback behavior
    - **Property 8: Auto routing produces refined prompt or failure flag**
    - **Property 9: Complexity score range invariant**
    - **Property 11: Scoring failure defaults to score 2**
    - **Property 22: Routing failure falls back to default model without error**
    - **Validates: Requirements 4.1, 4.4, 5.1, 5.5, 12.1, 12.2, 12.4**

  - [ ]* 5.3 Write property tests for routing state determination
    - **Property 12: No model selection implies auto state**
    - **Property 13: Explicit model selection implies manual state**
    - **Property 14: Manual state uses selected model**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5**

  - [ ]* 5.4 Write property tests for score-to-band mapping
    - **Property 10: Score-to-band mapping correctness**
    - **Validates: Requirements 5.3**

  - [ ]* 5.5 Write property test for reasoning summary
    - **Property 21: Reasoning summary is non-empty and references factors**
    - **Validates: Requirements 10.1, 10.2**

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Integrate Routing Engine into Inference Routes
  - [x] 7.1 Update inference routes to integrate routing engine
    - Modify `src/routes/inference.routes.ts` to:
    - Determine routing state: if no modelId or default option → `auto`, otherwise → `manual`
    - In `auto` state: call `routeRequest()` to get `RoutingDecision`, use `executedModelId` for inference
    - In `manual` state: validate model compatibility with images (reject text-only model + images), use selected model
    - Emit SSE `routing` event with routing metadata before streaming begins (when `metadataEnabled` config is true)
    - Include routing metadata in audit log entries
    - Wrap routing engine call in try/catch for fallback: on failure, use `qwen.qwen3-32b-v1:0` and log `routing-fallback`
    - _Requirements: 4.5, 5.4, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.5, 8.2, 10.3, 10.4, 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4_

  - [x] 7.2 Add password reset route and apply middleware
    - Add `POST /api/v1/auth/change-password` endpoint to `src/routes/auth.routes.ts`
    - Apply `forcePasswordResetMiddleware` after `authMiddleware` on protected routes (inference, models, admin)
    - Ensure change-password endpoint is excluded from the force-reset middleware
    - _Requirements: 1.3, 1.4, 1.9_

  - [ ]* 7.3 Write unit tests for routing integration in inference routes
    - Test auto routing path with mocked routing engine
    - Test manual routing path with model validation
    - Test fallback behavior when routing engine throws
    - Test SSE routing event emission
    - Test backward compatibility (clients ignoring routing event)
    - _Requirements: 11.2, 12.1, 12.4_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Frontend: UI Overhaul to beexexity Design
  - [x] 9.1 Overhaul Chat_UI with beexexity dark theme and layout
    - Rewrite `public/index.html` using the beexexity design language from `sampleui.html`
    - Apply CSS custom properties: `--bg-primary: #0f0f0f`, `--bg-secondary: #1a1a1a`, `--bg-tertiary: #262626`, `--accent: #b5e4f7`, `--text-primary: #ffffff`, `--text-secondary: #a0a0a0`, `--border: #2a2a2a`
    - Login screen: centered card on gradient background, rounded inputs (12px border-radius), accent-colored button
    - Header: sticky with `backdrop-filter: blur(12px)`, "beexexity" gradient logo, user avatar circle with first letter of display name
    - Messages: max-width 800px centered, user messages as right-aligned dark cards (16px border-radius, bottom-right 4px), assistant messages as left-aligned plain text with code/bold formatting
    - Empty state: centered "How can I help you today?" heading with subtitle
    - Input area: sticky bottom, max-width 800px, rounded card (16px border-radius) containing textarea, model select, plus-icon attach button, and send button
    - Send button: shows rotating spinner SVG while streaming, reverts to send arrow when done
    - Message fade-in animation: opacity 0→1, translateY 10px→0, 0.3s ease
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13_

  - [x] 9.2 Add password reset form to Chat_UI
    - When login response returns `requiresPasswordReset: true`, display a password-change form instead of the chat interface
    - Form requires current password and new password fields
    - On successful password change, store the returned token and show chat screen
    - Display validation errors from the server (too short, same as current, etc.)
    - _Requirements: 1.9_

  - [x] 9.3 Update model dropdown for auto routing and DeepSeek removal
    - Add a default "Auto (recommended)" option at the top of the model select dropdown that sends no modelId (triggers auto routing)
    - Remove DeepSeek V3 from the model dropdown options
    - Keep existing model selection behavior for manual mode
    - _Requirements: 3.3, 6.3, 6.4_

  - [x] 9.4 Display routing metadata in UI (development mode)
    - Handle the new SSE `routing` event type in the stream parser
    - When routing metadata is received, display a subtle indicator showing the executed model name
    - Ensure backward compatibility: gracefully ignore unknown SSE event types
    - _Requirements: 10.5, 11.1, 11.2_

- [x] 10. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The routing engine uses `qwen.qwen3-32b-v1:0` for both prompt refinement and complexity scoring via non-streaming Bedrock Converse calls
- All fallback paths are designed to be transparent to the end user — no errors surfaced when routing degrades
- The UI overhaul is based on the beexexity design language defined in `sampleui.html`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6"] },
    { "id": 1, "tasks": ["2.1", "2.4", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.5", "4.2", "4.3", "4.4", "4.5"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.5"] },
    { "id": 5, "tasks": ["7.1", "7.2"] },
    { "id": 6, "tasks": ["7.3", "9.1", "9.3"] },
    { "id": 7, "tasks": ["9.2", "9.4"] }
  ]
}
```
