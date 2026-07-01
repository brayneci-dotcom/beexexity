# Requirements — Chat History Sidebar

## Introduction

The Unified Inference Gateway currently exposes a single active session per user at `GET /api/v1/inference/sessions/active`. When a user clicks **New Chat** (existing button in the header, calls `POST /api/v1/inference/sessions/reset`), the old session is marked `inactive` and a fresh session is created on the next `/generate` call. Inactive sessions and their messages remain in the database but are **inaccessible** from the frontend — there is no way for a user to browse, review, or resume a previous conversation.

This feature adds a **chat history sidebar** to the SPA frontend and the corresponding backend endpoints to list, inspect, and resume past sessions. It also integrates with the **existing cost bar** (session total, current request cost, token in/out, request count) so that per-session statistics are visible both in the sidebar rows and in the cost bar when viewing a past session.

### Scope & Constraints

- **Server-rendered SPA** — the frontend is a single `public/index.html` file. All UI changes live there.
- **Existing data model** — sessions and messages tables already store everything needed. The `audit_logs` table already has `session_id`, `model_id`, `input_tokens`, `output_tokens` — so per-session token/cost statistics can be derived **without any schema migration**.
- **Existing cost bar preserved** — the cost bar at the top of the chat screen (`Session: Rp X`, `Current: Rp Y`, `Tokens: in/out`, `Requests: N`) remains, but its behavior becomes session-aware (see Requirement 6).
- **Existing New Chat button preserved** — the header button stays where it is; it gains a sidebar-refresh side effect (see Requirement 4).
- **No new dependencies** — all work uses the existing Express + vanilla JS stack already in `public/index.html`.
- **Auth gating** — all new endpoints require a valid JWT (via existing `authMiddleware`). Users can only see their own sessions.
- **PII compliance** — stored messages are already PII-masked. The sidebar displays sanitized content only; no unmasking is performed.

---

## Glossary

| Term | Definition |
|---|---|
| **Session** | A conversation container scoped to one user. Has a status (`active`, `inactive`, `degraded`, `expired`) and a turn count. |
| **Active session** | The single session with `status = 'active'` and `expires_at > NOW()` that receives new `/generate` requests. At most one per user. |
| **Inactive session** | A session whose `status` has been set to `'inactive'` (via reset or explicit action). Its messages are preserved. |
| **Degraded session** | A session where assistant message persistence failed; still readable but may have missing turns. |
| **Session preview** | A compact summary row in the sidebar: first user message truncated to ~60 chars + timestamp + turn count + token total + estimated cost. |
| **Resume** | Reactivating an inactive session so new `/generate` calls append to it instead of creating a new session. |
| **Sidebar** | A left-side panel in the SPA that lists past sessions and provides navigation between them. |
| **Cost bar** | The existing bar below the header showing `Session: Rp X`, `Current: Rp Y`, `Tokens: in/out`, `Requests: N`. |
| **Session stats** | Aggregated totals for a session: total input tokens, total output tokens, total requests, and estimated USD cost — derived from `audit_logs WHERE session_id = $1 AND status = 'success'`. |

---

## Requirements

### Requirement 1: List Past Sessions in Sidebar

**User Story:** As a registered user, I want to see a list of my past conversation sessions in a sidebar so that I can quickly identify which conversation I want to revisit, along with a sense of its activity (how many turns, how many tokens, what it cost).

**Acceptance Criteria:**

1. WHEN the user loads the SPA and is authenticated, THEN a sidebar is visible on the left side of the screen showing the user's session history.
2. WHEN the user has no past sessions, THEN the sidebar displays an empty state message: "No conversations yet."
3. WHEN the user has past sessions, THEN each session is shown as a compact row containing:
   - The first user message of that session, truncated to 60 characters with an ellipsis if longer.
   - A relative timestamp (e.g. "2 hours ago", "Yesterday", "3 days ago") derived from `last_activity_at`.
   - The turn count (e.g. "3 turns").
   - **Total tokens** consumed by that session (input + output), formatted compactly (e.g. "12.5K tokens").
   - **Estimated cost** for that session in IDR (e.g. "Rp 15.20"), derived from `audit_logs` token counts × model pricing.
4. WHEN the session list is fetched, THEN results are ordered by `last_activity_at DESC` (most recent first).
5. WHEN the session list exceeds 50 items, THEN the response is paginated (50 per page) and the frontend shows a "Load more" button at the bottom of the list.
6. WHEN a session has status `degraded`, THEN the row displays a subtle warning icon (⚠️) with tooltip "Some messages may be missing."
7. WHEN the active session appears in the list, THEN it is visually highlighted (e.g. bold title, accent left-border) to distinguish it from inactive sessions.
8. WHEN fetching the session list fails (network error, 500), THEN the sidebar shows an error banner "Failed to load conversations" with a Retry button.
9. WHEN a session has zero successful audit log entries (no completed requests yet, e.g. a newly created session before the first AI response), THEN its token count and cost show "—" (dash placeholder).

---

### Requirement 2: View Past Conversation Messages

**User Story:** As a registered user, I want to click on a past session in the sidebar and see its full message history in the main chat area so that I can review what was discussed.

**Acceptance Criteria:**

1. WHEN the user clicks on an inactive/degraded session in the sidebar, THEN the main chat area loads and displays the full message transcript for that session, ordered chronologically (oldest first).
2. WHEN the transcript loads, THEN each message shows:
   - Role label ("You" for user, "Assistant" for assistant).
   - The sanitized message content.
   - A timestamp.
3. WHEN the user is viewing a past session's transcript, THEN the chat input area is **disabled** and shows placeholder text "Viewing past conversation — click Resume to continue."
4. WHEN the user is viewing a past session's transcript, THEN the **cost bar updates** to show that session's persisted stats (total tokens, total cost, request count) instead of the in-memory active-session values (see Requirement 6).
5. WHEN the user clicks back on the active session in the sidebar, THEN the cost bar reverts to showing the live in-memory values for the active session.
6. WHEN fetching messages fails, THEN an error banner is displayed in the chat area: "Failed to load conversation."
7. WHEN the user clicks on a different session while viewing a transcript, THEN the view switches to the newly selected session's messages and the cost bar updates accordingly.
8. WHEN the session has zero messages (edge case — degraded session before any persistence), THEN the chat area shows "This conversation has no messages."

---

### Requirement 3: Resume a Past Session

**User Story:** As a registered user, I want to resume a past conversation so that I can continue where I left off without losing context, and have the cost tracking pick up from where it left off.

**Acceptance Criteria:**

1. WHEN viewing a past (inactive or degraded) session's transcript, THEN a "Resume" button is visible above the chat input area.
2. WHEN the user clicks "Resume":
   - THEN the current active session (if any) is marked inactive.
   - THEN the selected session is reactivated (status set to `active`, `last_activity_at` and `expires_at` refreshed).
   - THEN the chat input becomes enabled with placeholder "Continue conversation…".
   - THEN the sidebar refreshes to reflect the new active session.
   - THEN the full message history is loaded into the inference context for subsequent `/generate` calls.
   - THEN the **cost bar** resets its in-memory counters (`sessionCosts`, `sessionTotal`) to zero for the newly resumed session (new requests will add to the historical totals from `audit_logs`). The "Session" cost field shows the historical cost from `audit_logs` plus any new live additions.
3. WHEN the resume operation fails (e.g. session was deleted between listing and resuming), THEN an error toast is shown: "Failed to resume conversation. It may have been deleted."
4. WHEN the user resumes a session, THEN the `turn_count` is preserved (not reset to zero) so the session's history remains accurate.
5. WHEN the user is already viewing the active session, THEN the Resume button is not shown (it's already active).
6. WHEN a session is expired (`expires_at < NOW()`), THEN the Resume button is replaced with "Expired" (disabled) and a tooltip explains the session can no longer be continued.

---

### Requirement 4: Integrate Existing New Chat Button with Sidebar

**User Story:** As a registered user, I want the existing "New Chat" button (in the header) to work seamlessly with the sidebar — when I start a new chat, the old session should appear in the sidebar and the cost bar should reset for the fresh session.

**Acceptance Criteria:**

1. THE existing "New Chat" button in the header is **preserved** — its position, styling, and core behavior (`POST /api/v1/inference/sessions/reset` → clear messages → reset `currentSessionId`) remain unchanged.
2. WHEN the user clicks "New Chat", THEN in addition to the existing behavior:
   - THEN the sidebar **refreshes** its session list so the just-inactivated session appears in the list with its updated status.
   - THEN the in-memory cost tracking (`sessionCosts` array, `sessionTotal`) is **reset to zero**.
   - THEN the cost bar displays `Rp 0.00` for session cost, `Rp 0.00` for current cost, `0 / 0` for tokens, and `0` for requests.
   - THEN the sidebar removes the active-session highlight from any row (no session is active until the first message of the new chat is sent).
3. WHEN the user clicks "New Chat" while the chat area is already empty (no active session, no transcript loaded), THEN the operation is idempotent — no duplicate API call, no error, sidebar still refreshes.

---

### Requirement 5: Backend — List Sessions Endpoint (with Stats)

**User Story:** As the SPA frontend, I need an API endpoint to retrieve a paginated list of the authenticated user's sessions with a preview of each and aggregated token/cost statistics.

**Acceptance Criteria:**

1. WHEN `GET /api/v1/sessions` is called with a valid JWT, THEN the response is `200` with:
   ```json
   {
     "sessions": [
       {
         "id": "uuid",
         "status": "active",
         "turnCount": 5,
         "lastActivityAt": "2026-06-30T10:00:00.000Z",
         "createdAt": "2026-06-30T09:00:00.000Z",
         "expiresAt": "2026-06-30T18:00:00.000Z",
         "preview": "First 60 chars of the earliest user message…",
         "stats": {
           "totalInputTokens": 12500,
           "totalOutputTokens": 3200,
           "requestCount": 5,
           "estimatedCostUsd": 0.0157
         }
       }
     ],
     "total": 25,
     "page": 1,
     "pageSize": 50,
     "hasMore": false
   }
   ```
2. WHEN `?page=2&pageSize=50` query params are provided, THEN pagination is applied.
3. WHEN no JWT is provided, THEN `401` is returned (via existing `authMiddleware`).
4. WHEN the user has zero sessions, THEN `{ "sessions": [], "total": 0, "hasMore": false }` is returned (not 404).
5. WHEN the `preview` field is populated, THEN it contains the `sanitized_content` of the **first user message** (earliest by `created_at`) in that session, truncated to 60 characters with `…` appended if truncated.
6. WHEN a session has no messages (edge case), THEN `preview` is `null` and `stats` is `null`.
7. Sessions with `status = 'expired'` are included in the list (they can still be viewed, just not resumed).
8. The `stats` object is derived from a **single aggregated query** against `audit_logs`:
   ```sql
   SELECT COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
          COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
          COUNT(*) AS request_count
   FROM audit_logs
   WHERE session_id = $1 AND status = 'success'
   ```
   The `estimatedCostUsd` is computed server-side by summing `(input_tokens * model_pricing.input + output_tokens * model_pricing.output) / 1_000_000` per audit log row — **not** returned in the list endpoint for performance reasons (the list query already joins `audit_logs` for token counts; cost is calculated on demand via Requirement 9).
9. **Performance**: the session list query uses a lateral join or subquery to fetch `preview` and `stats` in a single round-trip, avoiding N+1 queries.
10. **Expiry sweep**: before returning results, a lightweight `UPDATE sessions SET status = 'expired' WHERE expires_at <= NOW() AND status != 'expired'` runs in the same transaction to keep the list accurate.

---

### Requirement 6: Backend — Get Session Stats Endpoint

**User Story:** As the SPA frontend, I need a dedicated endpoint to retrieve a specific session's accumulated token and cost statistics so I can update the cost bar when the user views a past session.

**Acceptance Criteria:**

1. WHEN `GET /api/v1/sessions/:id/stats` is called with a valid JWT and a session owned by the user, THEN the response is `200` with:
   ```json
   {
     "sessionId": "uuid",
     "totalInputTokens": 12500,
     "totalOutputTokens": 3200,
     "requestCount": 5,
     "estimatedCostUsd": 0.0157,
     "breakdown": [
       { "modelId": "qwen.qwen3-32b-v1:0", "inputTokens": 10000, "outputTokens": 2500, "requestCount": 4, "estimatedCostUsd": 0.0100 },
       { "modelId": "qwen.qwen3-235b-a22b-2507-v1:0", "inputTokens": 2500, "outputTokens": 700, "requestCount": 1, "estimatedCostUsd": 0.0057 }
     ]
   }
   ```
2. WHEN the session ID does not exist or belongs to a different user, THEN `404` is returned.
3. The `estimatedCostUsd` is computed by iterating over each successful audit log row and applying `(input_tokens * model_pricing.input + output_tokens * model_pricing.output) / 1_000_000` using the **pricing that was current at request time** (pricing is stored in a new `model_pricing_snapshot` JSONB column on `audit_logs` — see Requirement 9).
4. WHEN the session has no successful audit log entries, THEN all values are `0` and `breakdown` is an empty array.
5. This endpoint is called **on demand** when the user clicks a session in the sidebar, not during initial list load.

---

### Requirement 7: Backend — Get Session Messages Endpoint

**User Story:** As the SPA frontend, I need an API endpoint to retrieve the full message history for a specific session.

**Acceptance Criteria:**

1. WHEN `GET /api/v1/sessions/:id/messages` is called with a valid JWT and a session ID owned by the user, THEN the response is `200` with:
   ```json
   {
     "session": { "id": "uuid", "status": "inactive", "turnCount": 3, … },
     "messages": [
       { "role": "user", "content": "masked text", "createdAt": "…" },
       { "role": "assistant", "content": "masked text", "createdAt": "…" }
     ]
   }
   ```
2. WHEN the session ID does not exist, THEN `404` is returned with `{ "error": "SESSION_NOT_FOUND" }`.
3. WHEN the session belongs to a different user, THEN `404` is returned (do not reveal existence).
4. WHEN the session exists and belongs to the user, THEN all messages are returned ordered by `created_at ASC, id ASC`.
5. Messages are returned regardless of session status (active, inactive, degraded, expired).
6. WHEN the session has many messages (>500), THEN the full list is returned without pagination (messages are bounded by the context window character budget, so this is safe).

---

### Requirement 8: Backend — Resume Session Endpoint

**User Story:** As the SPA frontend, I need an API endpoint to reactivate an inactive session so the user can continue the conversation.

**Acceptance Criteria:**

1. WHEN `POST /api/v1/sessions/:id/resume` is called with a valid JWT and a session ID owned by the user, THEN:
   - Any currently active session for this user is marked `inactive`.
   - The target session is set to `status = 'active'`, `last_activity_at = NOW()`, `expires_at = NOW() + expiryHours`.
   - The response is `200` with the updated session object.
2. WHEN the target session is already active, THEN `200` is returned (idempotent).
3. WHEN the target session is expired (`expires_at < NOW()`), THEN `400` is returned with `{ "error": "SESSION_EXPIRED", "message": "Cannot resume an expired session" }`.
4. WHEN the target session does not exist or belongs to a different user, THEN `404` is returned.
5. WHEN the database update fails, THEN `500` is returned with `{ "error": "SESSION_RESUME_ERROR" }`.

---

### Requirement 9: Backend — Persist Model Pricing on Audit Logs

**User Story:** As the system, I need to record the model pricing that was in effect at the time of each inference request so that historical session cost can be accurately calculated even if pricing changes later.

**Acceptance Criteria:**

1. A new migration `006_audit_pricing_snapshot.sql` adds a column `model_pricing_snapshot JSONB` to `audit_logs` (nullable, default `NULL`).
2. WHEN the audit service logs a successful inference, THEN it writes the current model pricing (`inputPricePer1MTokens`, `outputPricePer1MTokens`) into `model_pricing_snapshot` for that row.
3. Existing rows with `model_pricing_snapshot IS NULL` are treated as "cost unknown" — the stats endpoint returns `estimatedCostUsd: null` for those rows and excludes them from the `breakdown` cost calculation (token counts are still reported).
4. No backfill of existing rows is required — they simply show cost as unavailable.

---

### Requirement 10: Frontend — Cost Bar Session Awareness

**User Story:** As a registered user, I want the cost bar to accurately reflect the session I'm currently looking at — live in-memory totals for the active session, and persisted stats for a past session I'm reviewing.

**Acceptance Criteria:**

1. WHEN the user is in the **active session** (sending and receiving messages), THEN the cost bar behaves exactly as it does today:
   - `Session` shows the running total of all requests in the current browser session (`sessionTotal`), formatted in IDR.
   - `Current` shows the cost of the most recent request, formatted in IDR.
   - `Tokens` shows the input/output token counts from the most recent `metadata` SSE event.
   - `Requests` shows the length of the `sessionCosts` array.
2. WHEN the user clicks on a **past session** in the sidebar to view its transcript, THEN the cost bar:
   - Calls `GET /api/v1/sessions/:id/stats` and displays the persisted totals.
   - `Session` shows the persisted `estimatedCostUsd` converted to IDR.
   - `Current` shows `Rp 0.00` (no active request).
   - `Tokens` shows the persisted `totalInputTokens / totalOutputTokens`.
   - `Requests` shows the persisted `requestCount`.
3. WHEN the user resumes a past session and sends a new message, THEN the cost bar:
   - `Session` shows **historical cost + new live additions** (persisted `estimatedCostUsd` + in-memory `sessionTotal`).
   - `Current` updates normally from SSE `metadata` events.
   - `Tokens` shows the **latest request** token counts (from the SSE event, not cumulative).
   - `Requests` shows **historical count + new live count**.
4. WHEN the user clicks "New Chat", THEN the cost bar fully resets to zero (as in Requirement 4).
5. WHEN the stats endpoint fails (network error), THEN the cost bar shows the in-memory values as a fallback (no disruption to the active session).

---

## Notes

- **Existing endpoints preserved** — `GET /api/v1/inference/sessions/active` and `POST /api/v1/inference/sessions/reset` are kept for backward compatibility. The frontend continues to use them for the active session flow.
- **New route prefix** — the new endpoints live under `/api/v1/sessions` (a new router file `src/routes/session.routes.ts`) to keep concerns separated from the inference routes.
- **Frontend approach** — the SPA in `public/index.html` is a single ~63 KB file. The sidebar is implemented as a CSS-styled `<div>` panel appended to the existing layout. State management stays in-memory (a `sidebarState` object) — no new framework.
- **Migration required** — one new migration (`006_audit_pricing_snapshot.sql`) adds `model_pricing_snapshot JSONB` to `audit_logs`. No other schema changes needed.
- **Cost bar DOM unchanged** — the four `<span>` elements in the cost bar (`session-cost`, `current-cost`, `tokens-in`, `tokens-out`, `request-count`) keep their IDs. A new function `updateCostBarFromStats(stats)` populates them from persisted data; the existing `updateCurrentCost()` and `updateSessionDisplay()` continue to work for live data.
- **Pricing source** — the server already knows model pricing from `src/config/model-capabilities.ts`. The `GET /api/v1/sessions/:id/stats` endpoint imports the same pricing map to compute `estimatedCostUsd`.
- **IDR conversion** — the frontend already fetches the USD → IDR rate once per session and caches it in `idrRate`. The stats endpoint returns USD; the frontend converts using its cached rate.
- **Pagination rationale** — 50 items per page balances usability with performance. The session list query uses a single aggregated query with lateral joins, not N+1.

---

## Open Questions

1. **Search/filter?** Should the sidebar include a search box to filter sessions by content? Decision: **No** — out of scope. Can be added later.
2. **Delete session?** Should users be able to delete past sessions? Decision: **No** — out of scope. Audit trail and data retention requirements for Indonesian banking mean we keep everything.
3. **Sidebar default state?** Should the sidebar be open or collapsed on first load? Decision: **Open** on desktop (screen width ≥ 768px), **collapsed** (hamburger toggle) on mobile.
4. **Cost precision for sidebar rows?** Should the cost in sidebar rows show Rp or a compact format? Decision: **Compact Rp** (e.g. "Rp 15.20", "Rp 1.5K" for values ≥ 1000). Exact values are available in the cost bar when viewing the session.
