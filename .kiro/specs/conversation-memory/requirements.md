# Requirements Document

## Introduction

This feature adds server-side multi-turn conversation memory to the Unified Inference Gateway. The current gateway is stateless at the inference layer, meaning each request is processed primarily from the current prompt and attached inputs. The revised design introduces session-scoped conversation history so that the gateway can assemble prior turns and send them to the Amazon Bedrock ConverseStream API on subsequent requests, enabling coherent follow-up interactions while preserving the existing requirements for authentication, PII masking, audit logging, routing, and regional processing constraints.[1][2][3][4]

The implementation must be privacy-conscious and operationally conservative. Conversation history shall be stored server-side, but only in sanitized form suitable for replay to models and safe recovery after page refresh or transient connectivity issues. Context assembly shall use a recency-first policy with optional summary compaction and a hard token budget, rather than replaying unlimited raw history, because Bedrock conversation APIs are stateless and history must be managed explicitly by the application.[3][4][5][6]

## Glossary

- **Session**: A logical conversation container associated with one authenticated user and one active chat thread.
- **Session_ID**: The unique identifier for a Session.
- **Conversation_History**: The ordered list of sanitized Message records associated with a Session.
- **Message**: A stored turn with role, content, timestamps, and storage metadata.
- **Sanitized_Content**: Content that has passed PII masking or post-generation safety sanitization and is eligible for storage and model replay.
- **Session_Store**: The server-side PostgreSQL persistence layer that stores Sessions and Messages.
- **Context_Window**: The subset of Conversation_History selected for replay to the model for the current request.
- **Token_Budget**: The configured maximum estimated token budget allocated to replayable conversation context.
- **Summary_Block**: A compact system-managed summary of earlier turns used when raw history would otherwise exceed the Token_Budget.
- **Inference_Gateway**: The Express.js backend that authenticates requests, masks PII, assembles context, routes requests, invokes models, and streams responses.
- **Routing_Engine**: The service that scores complexity and determines auto-routing behavior.

## Requirements

### Requirement 1: Session Lifecycle Management

**User Story:** As a user, I want my conversation to persist across multiple messages within a session, so that follow-up questions keep relevant context.

#### Acceptance Criteria

1. WHEN a user sends an inference request without a valid active Session_ID, THE Inference_Gateway SHALL create a new Session and associate it with the authenticated user.
2. WHEN a user sends an inference request with a valid active Session_ID owned by that user, THE Inference_Gateway SHALL append the new turn to that Session.
3. THE Session_Store SHALL persist each Session with at least: Session_ID, user_ID, created_at, updated_at, status, and last_activity_at.
4. WHEN a user explicitly starts a new chat, THE current Session SHALL be marked inactive and a new Session SHALL be created on the next request.
5. WHEN a user logs out, THE Inference_Gateway MAY mark active Sessions inactive immediately or allow them to expire naturally, but the chosen behavior SHALL be consistent and documented.
6. WHEN a Session has been inactive longer than the configured expiry period, THE Inference_Gateway SHALL treat it as expired and SHALL NOT append new messages to it.
7. THE default expiry period SHALL be configurable, with an initial default of 24 hours.
8. THE system SHALL define concurrency behavior explicitly: multiple tabs may reference the same active Session_ID, and message appends SHALL be stored in arrival order using server timestamps.

### Requirement 2: Message Storage and Sanitization

**User Story:** As a system operator, I want stored conversation history to be safe to retain and replay, so that session memory does not become an uncontrolled sensitive-data store.

#### Acceptance Criteria

1. WHEN a user submits a prompt, THE Inference_Gateway SHALL apply PII masking before storing the user message.[1][2]
2. THE Session_Store SHALL persist only sanitized user content, not the raw pre-mask text.[1][2]
3. WHEN an assistant response completes successfully, THE Inference_Gateway SHALL sanitize the assistant content before storing it, using policy-appropriate post-generation PII or sensitive-data checks.
4. THE Session_Store SHALL persist each Message with at least: message_ID, Session_ID, role, sanitized_content, created_at, and storage_flags.
5. THE Session_Store SHALL return Messages ordered by creation timestamp ascending, with deterministic tie-breaking by message_ID when timestamps are equal.
6. IF message persistence fails, THEN THE inference request MAY continue, but THE Gateway SHALL log the failure and flag the Session as partially persisted for observability.
7. THE system SHALL NOT store streamed partial assistant deltas as separate Messages; only the finalized assistant response SHALL be stored.

### Requirement 3: Context Assembly Strategy

**User Story:** As a user, I want the assistant to remember earlier parts of the conversation without degrading performance or exceeding model context limits.

#### Acceptance Criteria

1. WHEN an inference request is processed, THE Inference_Gateway SHALL retrieve sanitized Conversation_History for the active Session and assemble a replayable Context_Window for the Bedrock ConverseStream request.[3][4]
2. THE Context_Window SHALL include messages in chronological order and SHALL end with the current user message as the final entry.[4]
3. THE context assembly policy SHALL prioritize the most recent turns first.
4. THE default policy SHALL preserve the most recent message pairs verbatim and MAY include a Summary_Block representing older turns when configured.[5][7][6]
5. IF the assembled context still exceeds the Token_Budget after summary compaction, THEN THE Inference_Gateway SHALL truncate the oldest replayable turns until the budget is satisfied.[5][8]
6. THE system SHALL maintain a hard configurable Token_Budget for replayable history, with an initial default of 200,000 estimated tokens.
7. The token estimate SHALL be treated as an approximation for context selection, not as an exact provider tokenizer guarantee.
8. THE implementation SHALL reserve a configurable safety margin for the current prompt, system instructions, attachments-derived text, and model response headroom.

### Requirement 4: Token Estimation and Budget Control

**User Story:** As a platform owner, I want predictable context budgeting, so that conversation history does not break requests or consume unreasonable model context.

#### Acceptance Criteria

1. THE Inference_Gateway SHALL estimate token usage for stored conversation content before assembling the Bedrock request.
2. THE initial implementation MAY use a character-based approximation, but it SHALL be configurable and clearly documented as an estimate, not an exact tokenizer.
3. THE default approximation MAY assume 4 characters per token as a coarse heuristic, but the system SHALL also apply a conservative safety margin before request execution.
4. THE Gateway SHALL expose configuration for token budget, safety margin, and summary-trigger threshold.
5. IF the estimated context exceeds the allowed budget even after truncation logic, THEN THE Gateway SHALL reject the request or reduce context further according to configured policy and SHALL log the event.

### Requirement 5: Frontend Session Integration

**User Story:** As a user, I want to continue a chat across refreshes and also start a clean conversation when needed.

#### Acceptance Criteria

1. WHEN the Frontend_Client sends an inference request, THE client SHALL include the current Session_ID if one is available.
2. WHEN the Inference_Gateway returns a Session_ID, THE Frontend_Client SHALL retain it in memory for subsequent requests.
3. WHEN the user starts a new chat, THE Frontend_Client SHALL clear the current Session_ID and invoke the session reset endpoint.
4. WHEN the page loads, THE Frontend_Client SHALL request the active session and sanitized Conversation_History for the authenticated user.
5. IF the Session_ID is invalid, expired, or not owned by the current user, THEN THE Frontend_Client SHALL clear local session state and treat the next request as a new session.
6. THE UI SHALL render previously stored messages using the sanitized content returned by the backend.

### Requirement 6: PII Handling Across Session Memory

**User Story:** As a compliance stakeholder, I want PII controls applied consistently across session memory, so that saved and replayed history stays within policy.[1][2]

#### Acceptance Criteria

1. THE Inference_Gateway SHALL send only sanitized user messages to the model as part of replayed history.[1][2]
2. THE Inference_Gateway SHALL store only sanitized user messages in the Session_Store.[1][2]
3. THE Inference_Gateway SHALL sanitize assistant messages before storing them if policy requires post-generation inspection.
4. THE system SHALL define and document whether assistant sanitization is mandatory blocking behavior or best-effort behavior; the default for regulated environments SHOULD be mandatory before persistence.
5. THE Session history retrieval endpoint SHALL return only sanitized content.

### Requirement 7: Routing Engine Context Awareness

**User Story:** As a user, I want routing decisions to reflect conversational complexity without turning session length into a blunt scoring hack.

#### Acceptance Criteria

1. WHEN the Routing_Engine evaluates an auto-routed request, IT MAY include a compact representation of recent conversation context in the scoring input.
2. THE initial implementation SHALL limit routing-context enrichment to recent sanitized user turns only, excluding the current prompt.
3. THE default enrichment policy SHALL include up to the last 2 prior user messages, capped at 500 characters total.
4. Any score adjustment derived from session depth or history length SHALL be configurable and logged with a reason code.
5. THE system SHALL NOT hardcode irreversible scoring inflation purely from message count without configuration support and observability.

### Requirement 8: Session History API Endpoints

**User Story:** As a frontend developer, I want explicit session endpoints, so that the UI can restore or reset conversations predictably.

#### Acceptance Criteria

1. THE Inference_Gateway SHALL expose a GET endpoint at `/api/v1/inference/sessions/active` that returns the active Session and sanitized Conversation_History for the authenticated user.
2. WHEN no active Session exists, THE endpoint SHALL return HTTP 200 with a null or empty Session object and an empty messages array.
3. THE endpoint SHALL return at least: Session_ID, status, created_at, updated_at, and messages containing role, content, and created_at.
4. THE endpoint SHALL require the same authentication middleware as the inference endpoint.
5. THE Inference_Gateway SHALL expose a POST endpoint at `/api/v1/inference/sessions/reset` that marks the current active Session inactive and returns HTTP 200.
6. THE reset endpoint SHALL be idempotent.

### Requirement 9: Audit Logging Integration

**User Story:** As a system operator, I want session-aware observability, so that troubleshooting and usage analysis remain possible after conversation memory is added.

#### Acceptance Criteria

1. WHEN an inference request is processed within a Session, THE audit log entry SHALL include the Session_ID.
2. THE audit log entry SHALL include the number of prior messages replayed to the model for that request.
3. IF truncation or summary compaction is applied, THEN THE audit log entry SHALL include corresponding counts or flags.
4. THE audit log SHALL NOT persist raw conversation content through routing or memory metadata fields.
5. THE system SHALL expose operational metrics for active sessions, average replayed-message count, truncation frequency, and storage failure rate.

## Notes

- Amazon Bedrock conversation APIs support multi-turn messaging, but the application remains responsible for storing and resending history across turns.[3][4]
- For long sessions, summary-plus-window memory is preferred over naive full-history replay because it preserves coherence while controlling context growth.[5][7][6]
- In regulated environments, sanitization policy must apply not only to incoming user text but also to any stored assistant output that could echo sensitive information.[1][2]