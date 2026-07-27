# Implementation Plan: Conversation Memory

## Overview

This plan implements server-side multi-turn conversation memory for the Unified Inference Gateway. Tasks are ordered infrastructure-first: types and configuration, then database migration, then services (session, context assembly), then route integration with generate() modifications, then frontend changes, and finally audit/routing enrichment wiring.

## Tasks

- [x] 1. Define types, configuration, and database schema
  - [x] 1.1 Create session and context assembly types
    - Create `src/types/session.types.ts` with `Session`, `StoredMessage`, `StorageFlags`, `BedrockMessage`, `ContextAssemblyConfig`, `AssembledContext`, and `ConversationInferenceRequest` interfaces
    - Export `ConversationInferenceResult` extending `InferenceResult` with `assistantText: string`
    - _Requirements: 1.3, 2.4, 3.1, 3.6_

  - [x] 1.2 Add session configuration to config/index.ts
    - Add `session` block with `expiryHours`, `tokenBudget`, `safetyMargin`, `summaryThreshold`, `charsPerToken`, `routingContextMaxChars`, `routingContextMaxTurns` from env vars with defaults
    - _Requirements: 1.7, 3.6, 4.4, 7.3_

  - [x] 1.3 Create database migration 004_conversation_memory.sql
    - Create `sessions` table with id, user_id, status, created_at, updated_at, last_activity_at, expires_at
    - Create `messages` table with id, session_id, role, sanitized_content, created_at, storage_flags
    - Add indexes: `idx_sessions_user_active` (partial on status='active'), `idx_sessions_expires_at`, `idx_messages_session_order`
    - ALTER `audit_logs` to add session_id, replayed_message_count, context_truncated, context_summarized columns
    - _Requirements: 1.3, 2.4, 9.1, 9.2, 9.3_

- [x] 2. Implement Session Service
  - [x] 2.1 Create session service with core CRUD operations
    - Create `src/services/session.service.ts`
    - Implement `getOrCreateSession(userId, sessionId?)`: validate ownership, expiry, create if needed with `expiresAt = now + expiryHours`
    - Implement `getActiveSession(userId)`: query for active session owned by user
    - Implement `getSessionMessages(sessionId, limit?)`: return messages ordered by created_at ASC, id ASC
    - Implement `storeMessage(sessionId, role, content, flags)`: insert message and call touchSession
    - Implement `markSessionInactive(sessionId)`: set status to 'inactive'
    - Implement `isSessionExpired(session)`: compare expires_at with now
    - Implement `touchSession(sessionId)`: update last_activity_at and updated_at
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.4, 2.5, 2.6_

  - [ ]* 2.2 Write property tests for session service
    - **Property 1: Session creation ownership**
    - **Property 2: Message append grows list by one**
    - **Property 3: Session reset then create produces new session**
    - **Property 4: Expired sessions are rejected**
    - **Property 7: Message retrieval ordering**
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.6, 2.5**

  - [ ]* 2.3 Write unit tests for session service
    - Test getOrCreateSession with valid/invalid/expired sessionId
    - Test message storage and retrieval ordering
    - Test markSessionInactive idempotence
    - Test touchSession updates timestamps
    - Test concurrent appends use server timestamps
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.8_

- [x] 3. Implement Context Assembly Service
  - [x] 3.1 Create context assembly service with token budgeting
    - Create `src/services/context-assembly.service.ts`
    - Implement `assembleContext(sessionMessages, currentPrompt, config)`: recency-first selection within token budget
    - Implement `estimateTokens(text, charsPerToken)`: `Math.ceil(text.length / charsPerToken)`
    - Algorithm: calculate available budget, accumulate from most-recent backwards, truncate oldest when over budget, re-order chronologically
    - Return `AssembledContext` with messages, totalEstimatedTokens, truncated, truncatedCount, summarized, originalMessageCount
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3_

  - [ ]* 3.2 Write property tests for context assembly
    - **Property 9: Context window budget invariant**
    - **Property 10: Context window chronological order**
    - **Property 11: Token estimation formula**
    - **Validates: Requirements 3.3, 3.5, 3.8, 3.1, 3.2, 4.3**

  - [ ]* 3.3 Write unit tests for context assembly
    - Test empty history returns empty messages
    - Test single message within budget
    - Test exactly-at-budget boundary
    - Test truncation drops oldest first
    - Test re-ordering to chronological after selection
    - Test safety margin subtracted from budget
    - _Requirements: 3.3, 3.5, 4.1, 4.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Modify generate() for multi-turn conversation support
  - [x] 5.1 Extend generate() to accept ConversationInferenceRequest
    - Update `src/services/inference.service.ts` to detect `request.messages` array
    - When messages present: use full messages array in `ConverseStreamCommand` instead of single user message
    - Accumulate full assistant text from `contentBlockDelta` events
    - Return `ConversationInferenceResult` with `assistantText` field
    - Maintain backward compatibility with existing `InferenceRequest` (single prompt)
    - _Requirements: 3.1, 2.7_

  - [ ]* 5.2 Write unit tests for generate() conversation mode
    - Test single-message backward compatibility unchanged
    - Test multi-message request builds correct ConverseStreamCommand
    - Test assistantText accumulation from stream deltas
    - _Requirements: 3.1, 2.7_

- [x] 6. Implement session API endpoints
  - [x] 6.1 Add GET /api/v1/inference/sessions/active endpoint
    - Add route to `src/routes/inference.routes.ts`
    - Protected by authMiddleware
    - Returns `{ session, messages }` where messages contain role, content, createdAt
    - When no active session: return HTTP 200 with `{ session: null, messages: [] }`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 6.2 Add POST /api/v1/inference/sessions/reset endpoint
    - Add route to `src/routes/inference.routes.ts`
    - Protected by authMiddleware
    - Mark active session inactive via session service
    - Return HTTP 200 `{ success: true }` (idempotent)
    - _Requirements: 8.5, 8.6_

  - [ ]* 6.3 Write unit tests for session endpoints
    - Test GET /sessions/active returns active session with messages
    - Test GET /sessions/active returns empty when no session
    - Test POST /sessions/reset marks session inactive
    - Test POST /sessions/reset idempotent when no active session
    - Test both endpoints require auth
    - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6_

- [x] 7. Integrate session memory into inference route
  - [x] 7.1 Modify handleJsonInference to use session memory
    - After PII masking: call `getOrCreateSession(userId, sessionId)` from request body
    - Store masked user message via `storeMessage`
    - Call `assembleContext` to build context window
    - Build `ConversationInferenceRequest` with assembled messages + current prompt as final message
    - After successful generate: sanitize assistant text, store via `storeMessage`
    - Emit `session` SSE event with sessionId for frontend
    - Handle message persistence failure gracefully (log, continue)
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.6, 2.7, 3.1, 3.2, 6.1, 6.2, 6.3_

  - [x] 7.2 Modify handleMultipartInference to use session memory
    - Apply same session logic as JSON handler
    - Store masked prompt (not file content) as user message
    - After successful generate: sanitize and store assistant response
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3_

  - [ ]* 7.3 Write property tests for PII/sanitization invariants
    - **Property 5: User messages stored and replayed only in sanitized form**
    - **Property 6: Assistant messages sanitized before storage**
    - **Validates: Requirements 2.1, 2.2, 2.3, 6.1, 6.2, 6.3**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Routing engine context enrichment
  - [x] 9.1 Add conversationContext to routing input
    - Extend `RoutingInput` in `src/types/routing.types.ts` with optional `conversationContext?: string`
    - In inference route: build routing context from last N prior user messages (configurable), capped at `routingContextMaxChars`
    - Pass `conversationContext` to `routeRequest` — include in scoring prompt only
    - Log routing context usage with reason code
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 9.2 Write property tests for routing context bounds
    - **Property 12: Routing context bounds**
    - **Validates: Requirements 7.2, 7.3**

  - [ ]* 9.3 Write unit tests for routing context enrichment
    - Test context built from prior user messages only
    - Test exclusion of current prompt
    - Test max turns limit
    - Test max chars truncation
    - _Requirements: 7.2, 7.3_

- [x] 10. Audit logging integration
  - [x] 10.1 Extend audit logging with session metadata
    - Update `AuditEntry` interface in `src/types/audit.types.ts` with sessionId, replayedMessageCount, contextTruncated, contextSummarized
    - Update `auditService.log()` calls in inference routes to include session fields
    - Ensure no raw message content leaks into audit fields
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 10.2 Write property tests for audit entries
    - **Property 14: Audit entries contain session metadata without raw content**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [ ]* 10.3 Write unit tests for audit logging
    - Test session_id included in audit entry
    - Test replayed_message_count reflects assembled context
    - Test truncation flags logged correctly
    - Test no raw content in any audit field
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 11. Frontend session integration
  - [x] 11.1 Add session state management and history loading
    - Add `currentSessionId` state variable in `public/index.html` script
    - On page load after auth: fetch `GET /api/v1/inference/sessions/active`, render history messages, set `currentSessionId`
    - On send: include `sessionId` in request body
    - On response: extract `sessionId` from SSE `session` event, store in state
    - Handle invalid/expired session errors by clearing state
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

  - [x] 11.2 Add New Chat button and session reset
    - Add "New Chat" button to header UI
    - On click: call `POST /api/v1/inference/sessions/reset`, clear chat messages, clear `currentSessionId`
    - _Requirements: 5.3_

  - [ ]* 11.3 Write property tests for reset idempotence
    - **Property 13: Reset endpoint idempotence**
    - **Validates: Requirements 8.6**

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The session service uses server-side expiry checks (no background sweep needed for MVP)
- All stored content passes through `mask()` before persistence — existing PII masker is reused
- The `generate()` modification is backwards-compatible; existing single-prompt flow is preserved
- fast-check is already in devDependencies; vitest is the test runner

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "6.1", "6.2"] },
    { "id": 5, "tasks": ["6.3", "7.1", "7.2"] },
    { "id": 6, "tasks": ["7.3", "9.1", "10.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "10.2", "10.3"] },
    { "id": 8, "tasks": ["11.1", "11.2"] },
    { "id": 9, "tasks": ["11.3"] }
  ]
}
```
