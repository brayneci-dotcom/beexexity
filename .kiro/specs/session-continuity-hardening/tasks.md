# Implementation Plan: Session Continuity Hardening

## Overview

This plan hardens the existing conversation memory system with fail-fast persistence, degraded session state, a unified sliding-window context builder, frontend degraded banner, and observability enrichment. All tasks modify existing files — no new services are created from scratch.

## Tasks

- [x] 1. Database schema and configuration
  - [x] 1.1 Create migration `migrations/005_session_hardening.sql`
    - Add `degraded` to the `sessions.status` CHECK constraint (DROP + re-ADD wrapped in BEGIN/COMMIT)
    - Add `turn_count INTEGER NOT NULL DEFAULT 0` column to `sessions`
    - Add `session_state VARCHAR(16)` and `turn_count INTEGER` columns to `audit_logs`
    - _Requirements: 7.1, 7.2, 6.3_

  - [x] 1.2 Add config entries in `src/config/index.ts`
    - Add `maxHistoryTurns: parseInt(process.env.MAX_HISTORY_TURNS || '10', 10)` to the `session` block
    - Add `maxContextCharacters: parseInt(process.env.MAX_CONTEXT_CHARACTERS || '120000', 10)` to the `session` block
    - _Requirements: 8.1, 8.2_

- [x] 2. Session service hardening
  - [x] 2.1 Update `Session` type and row mapping in `src/types/session.types.ts` and `src/services/session.service.ts`
    - Add `'degraded'` to the `Session.status` union type
    - Add `turnCount: number` field to `Session` interface
    - Update `SessionRow` interface to include `turn_count`
    - Update `mapSessionRow` to map `turn_count` → `turnCount`
    - _Requirements: 1.1, 7.1, 7.2_

  - [x] 2.2 Implement `transitionToDegraded()` in `src/services/session.service.ts`
    - `UPDATE sessions SET status = 'degraded', updated_at = NOW() WHERE id = $1`
    - Idempotent — no error if already degraded
    - Export the function
    - _Requirements: 1.3, 1.4_

  - [x] 2.3 Implement `incrementTurnCount()` in `src/services/session.service.ts`
    - `UPDATE sessions SET turn_count = turn_count + 1, updated_at = NOW() WHERE id = $1`
    - Export the function
    - _Requirements: 7.2_

  - [x] 2.4 Implement `getValidatedSession()` in `src/services/session.service.ts`
    - Accept `(userId: string, sessionId?: string): Promise<Session>`
    - If no sessionId provided, call `getOrCreateSession` (existing)
    - If sessionId provided, fetch session, check ownership, check expiry
    - Throw `SessionExpiredError` if `expires_at` is in the past
    - Throw `SessionNotFoundError` if not found or foreign
    - Allow both `active` and `degraded` sessions to proceed
    - Export custom error classes from the file
    - _Requirements: 1.6, 2.1_

  - [ ]* 2.5 Write unit tests for session service hardening
    - Test `transitionToDegraded()` updates status
    - Test `incrementTurnCount()` increments the counter
    - Test `getValidatedSession()` throws `SessionExpiredError` for expired sessions
    - Test `getValidatedSession()` throws `SessionNotFoundError` for foreign sessions
    - Test `getValidatedSession()` allows `degraded` sessions
    - File: `tests/unit/session.service.test.ts`
    - _Requirements: 1.3, 1.6, 7.2_

- [x] 3. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Context builder refactor
  - [x] 4.1 Replace `assembleContext()` with `buildContext()` in `src/services/context-assembly.service.ts`
    - Define and export `ContextConfig` interface: `{ maxHistoryMessages, maxContextCharacters, systemPrompt? }`
    - Define and export `ContextOutput` interface: `{ inference_payload, routing_payload, truncated, historyMessageCount }`
    - Define and export `PromptTooLargeError` class
    - Implement `buildContext(sessionMessages, currentPrompt, config)`:
      1. GUARD: throw `PromptTooLargeError` if `currentPrompt.length > maxContextCharacters`
      2. Take last `maxHistoryMessages` from sessionMessages (sliding window)
      3. Drop oldest messages one-by-one if total chars (history + currentPrompt) exceeds `maxContextCharacters`
      4. Build `inference_payload`: history messages + current user prompt as `BedrockMessage[]`
      5. Build `routing_payload`: from selected history, filter role==='user' only, take last 2, concatenate content, cap at 500 chars. System prompt NEVER included. Return `undefined` if no prior user messages.
    - Keep `estimateTokens()` exported for backwards compatibility but it's no longer used internally
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3_

  - [ ]* 4.2 Write property test: sliding window respects message count limit and character budget
    - **Property 1: Sliding window respects message count limit and character budget**
    - Use fast-check to generate arbitrary-length StoredMessage arrays and ContextConfig values
    - Assert: inference_payload history length ≤ maxHistoryMessages
    - Assert: total character count of all message content ≤ maxContextCharacters
    - File: `tests/property/context-builder.property.test.ts`
    - **Validates: Requirements 3.2, 3.4**

  - [ ]* 4.3 Write property test: context output structural invariant
    - **Property 2: Context output structural invariant**
    - Assert: inference_payload is non-empty, every element has valid role and non-empty content
    - Assert: inference_payload ends with current user prompt
    - Assert: routing_payload is undefined or a string ≤ 500 chars
    - File: `tests/property/context-builder.property.test.ts`
    - **Validates: Requirements 3.3, 3.5, 4.2**

  - [ ]* 4.4 Write property test: sliding window selects most-recent messages
    - **Property 3: Sliding window selects most-recent messages**
    - For inputs with length > maxHistoryMessages, assert the included history messages are exactly the last N from the input in chronological order
    - File: `tests/property/context-builder.property.test.ts`
    - **Validates: Requirements 3.2**

  - [ ]* 4.5 Write property test: prompt-too-large rejection
    - **Property 7: Prompt-too-large rejection**
    - For any currentPrompt whose length > maxContextCharacters, assert buildContext throws PromptTooLargeError
    - File: `tests/property/context-builder.property.test.ts`
    - **Validates: Requirements 3.4**

- [x] 5. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Inference route rewrite
  - [x] 6.1 Add turn lock and rewrite `handleJsonInference` in `src/routes/inference.routes.ts`
    - Add `const activeTurns: Map<string, boolean> = new Map()` at module level
    - After session validation, check `activeTurns.get(sessionId)` → return HTTP 409 `TURN_IN_PROGRESS` if held
    - Set `activeTurns.set(sessionId, true)` and wrap entire turn lifecycle in `try { ... } finally { activeTurns.delete(sessionId) }`
    - Replace `getOrCreateSession` with `getValidatedSession` — catch `SessionExpiredError` → emit SSE error `SESSION_EXPIRED`
    - Add prompt-too-large pre-check: if `maskedPrompt.length > config.session.maxContextCharacters` → return HTTP 413 `PROMPT_TOO_LARGE`
    - Make user message `storeMessage` fail-fast: if it throws → return HTTP 500 `PERSISTENCE_ERROR` (do NOT call AI)
    - Replace `assembleContext` + `buildRoutingContext` with single `buildContext()` call
    - Use `contextOutput.inference_payload` for Bedrock request, `contextOutput.routing_payload` for routing engine
    - After streaming, try `storeMessage(assistant)`:
      - On SUCCESS → call `incrementTurnCount(sessionId)`
      - On FAILURE → call `transitionToDegraded(sessionId)`, emit SSE event `{ is_degraded: true }`
    - Remove the now-unused `buildRoutingContext()` helper function
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 1.3, 1.4, 1.6, 3.1, 4.1_

  - [x] 6.2 Apply same turn lifecycle changes to `handleMultipartInference` in `src/routes/inference.routes.ts`
    - Mirror turn lock, fail-fast user save, degrade-on-assistant-fail, incrementTurnCount logic
    - Use `buildContext()` instead of `assembleContext()` + `buildRoutingContext()`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 1.3, 1.4_

  - [ ]* 6.3 Write unit tests for inference route turn lifecycle
    - Test: HTTP 409 returned when turn lock is held for same session
    - Test: HTTP 500 returned when user message save fails (mocked DB)
    - Test: `is_degraded` SSE event emitted when assistant save fails
    - Test: `incrementTurnCount` called only on assistant save success
    - Test: Turn lock released even when Bedrock throws
    - Test: HTTP 413 returned for prompt exceeding maxContextCharacters
    - File: `tests/unit/inference.routes.test.ts`
    - _Requirements: 2.2, 2.3, 2.4, 1.3_

- [x] 7. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Observability enrichment
  - [x] 8.1 Enrich audit log with `session_state` and `turn_count` in `src/types/audit.types.ts` and `src/services/audit.service.ts`
    - Add `sessionState?: string` and `turnCount?: number` fields to `AuditEntry`
    - Update the `INSERT` query in `auditService.log()` to include `session_state` and `turn_count` columns
    - Update the `auditService.log()` calls in `inference.routes.ts` to pass `sessionState` and `turnCount` from the validated session
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 9. Frontend degraded banner and session expiry handling
  - [x] 9.1 Add degraded banner UI and session expiry toast in `public/index.html`
    - Add CSS for `.degraded-banner` (warning bar below header, amber background)
    - Add CSS for `.toast-notification` (brief notification shown on session expiry)
    - Add hidden `<div class="degraded-banner" id="degraded-banner">` element to HTML
    - In SSE event handler: listen for `is_degraded: true` → show degraded banner with text: "Chat history save failed. Future context may be lost."
    - On `SESSION_EXPIRED` or `SESSION_NOT_FOUND` error events: clear chat UI, reset `currentSessionId`, show toast: "Previous session expired. Started new session."
    - On page reload, trust backend `GET /sessions/active` response — do NOT cache/re-display stale messages
    - The degraded banner persists until user clicks "New Chat"
    - _Requirements: 1.5, 5.1, 5.2, 5.3_

  - [x] 9.2 Ensure send button and input are disabled during streaming in `public/index.html`
    - Verify `setStreaming(true)` disables both `#send-btn` and `#prompt-input`
    - Verify `setStreaming(false)` re-enables them
    - Ensure attach button is also disabled during streaming
    - _Requirements: 5.1_

- [x] 10. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design doc
- Unit tests validate specific examples and edge cases
- All modifications target existing files — this feature does NOT create new services
- The `buildContext()` function is pure (no DB calls) and ideal for property-based testing
- Turn lock is in-memory (per-process); this is acceptable for single-instance deployment

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4"] },
    { "id": 3, "tasks": ["2.5", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "4.5"] },
    { "id": 5, "tasks": ["6.1", "8.1"] },
    { "id": 6, "tasks": ["6.2"] },
    { "id": 7, "tasks": ["6.3", "9.1", "9.2"] }
  ]
}
```
