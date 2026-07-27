# Requirements Document

## Introduction

This feature fixes the core context-loss bug in the Unified Inference Gateway. Currently, the system treats each prompt as a stateless request, causing the AI to "forget" previous turns.

For this MVP, we will implement a strict turn-lifecycle that persists both user and assistant messages, and a unified context builder that sends the conversation history back to the model. We will prioritize simplicity, low latency, and reliability over advanced features like async summarization.

## Glossary

- **Session**: A logical conversation container.
- **Session_State**: One of `active`, `degraded`, or `expired`.
- **Turn**: One user message and one assistant message.
- **Sliding_Window**: The strategy of keeping only the most recent N messages to stay within token limits.
- **Context_Builder**: The service that gathers the session history and formats it for the LLM.
- **Turn_Committed**: The state after both user and assistant messages are persisted for a turn.

## Requirements

### Requirement 1: Basic Session State Management

**User Story:** As a user, I want the system to know if my conversation is healthy, so that I am notified if the system fails to save my chat history.

#### Acceptance Criteria

1. THE database SHALL support three session states: `active`, `degraded`, and `expired`.
2. WHEN a new session is created, the state SHALL be `active`.
3. WHEN the system fails to save an assistant response to the database, the session state SHALL transition to `degraded`.
4. WHEN a session is `degraded`, the backend SHALL return an `is_degraded: true` flag in the SSE response.
5. WHEN the frontend receives `is_degraded: true`, it SHALL display a warning banner: "Chat history save failed. Future context may be lost."
6. WHEN a session reaches its `expires_at` time, the backend SHALL reject new messages and force the creation of a new session.

### Requirement 2: Mandatory Turn Persistence (The Core Fix)

**User Story:** As a user, I want my chat history saved automatically, so that the AI remembers what we just talked about.

#### Acceptance Criteria

1. THE backend SHALL execute this exact sequence for every request: (a) Validate Session ID, (b) Save User Message to DB, (c) Build Context (fetch history), (d) Stream AI Response to Frontend, (e) Save Assistant Message to DB, (f) Mark Turn Complete.
2. IF step (b) Save User Message fails, the backend SHALL return an error and SHALL NOT call the AI.
3. IF step (e) Save Assistant Message fails, the backend SHALL transition the session to `degraded` and return the `is_degraded` flag to the frontend.
4. THE backend SHALL NOT start a new turn until the previous turn is marked complete (preventing race conditions).

### Requirement 3: Simple Sliding-Window Context Assembly

**User Story:** As a user, I want the AI to remember our recent conversation, but I don't want to pay for infinite context or experience high latency.

#### Acceptance Criteria

1. THE Context_Builder SHALL fetch the previous messages for the session from the database.
2. THE Context_Builder SHALL apply a Sliding_Window strategy: it SHALL only include the most recent N turns (configurable, default: 10 turns / 20 messages).
3. THE Context_Builder SHALL prepend a static System Prompt to the context array.
4. IF the total character count of the selected history exceeds a safe threshold (80% of the model's context window approximation), the Context_Builder SHALL drop the oldest messages until it fits.
5. THE Context_Builder SHALL output a single JSON array of messages formatted for the Bedrock ConverseStream API.

### Requirement 4: Unified Context for Routing and Inference

**User Story:** As a developer, I want the router and the AI to see the same conversation history, so they don't get confused.

#### Acceptance Criteria

1. THE Context_Builder SHALL be the single source of truth for assembling messages.
2. THE Context_Builder SHALL output two payloads from the same data: (a) `inference_payload` — the full array of messages (System prompt + History + Current User Prompt) for the AI, and (b) `routing_payload` — a condensed version (System prompt + Last 2 messages) for the Routing Engine.
3. THE routing payload SHALL NOT be built by a separate service reading directly from the database.

### Requirement 5: Frontend Continuity Handling

**User Story:** As a user, I want the UI to handle session errors gracefully without crashing or silently starting a new chat.

#### Acceptance Criteria

1. THE frontend SHALL disable the "Send" button and input field while waiting for a streaming response to finish.
2. WHEN the frontend sends a message with a session_id, and the backend returns a `session_not_found` or `expired` error, the frontend SHALL clear the current chat UI, generate a new session_id, and display a toast notification: "Previous session expired. Started new session."
3. THE frontend SHALL append incoming streamed text to the current assistant message bubble in real-time.

### Requirement 6: Basic Observability

**User Story:** As a developer, I want to know if the context-saving feature is failing in production.

#### Acceptance Criteria

1. THE backend SHALL log an ERROR level message whenever a database write for a message fails.
2. THE backend SHALL log a WARN level message whenever a session transitions to `degraded`.
3. THE backend SHALL include the `session_state` and `turn_count` in the audit log entry for every inference request.

### Requirement 7: Minimal Database Schema Updates

**User Story:** As a developer, I need the database to support saving history and tracking state.

#### Acceptance Criteria

1. THE `sessions` table SHALL have a `status` column supporting values: `active`, `degraded`, `expired`.
2. THE `sessions` table SHALL have a `turn_count` integer column, incremented on every successful turn.
3. THE `messages` table SHALL have a `role` column (`user` or `assistant`).
4. THE `messages` table SHALL have a `created_at` timestamp for ordering.
5. THE `messages` table SHALL be indexed on `(session_id, created_at)` for fast history retrieval.

### Requirement 8: Simple Configuration

**User Story:** As an operator, I want to tweak the memory size without redeploying code.

#### Acceptance Criteria

1. THE system SHALL read `MAX_HISTORY_TURNS` from environment variables (default: 10).
2. THE system SHALL read `MAX_CONTEXT_CHARACTERS` from environment variables (default: 120,000).

## Notes

- **No Summaries**: Intentionally skipping AI-generated summaries. Sliding window of the last 10 turns is sufficient for 90% of MVP use cases.
- **No Background Workers**: If a save fails, we fail fast. No retry queues for MVP.
- **Character Counting**: Using character counts as a proxy for tokens (assuming 1 token ≈ 4 characters) to avoid importing heavy tokenizer libraries.
- **Implementation Priority**: (1) Database & Schema, (2) Persistence Loop, (3) Context Builder, (4) Frontend Locking, (5) Degraded State.
