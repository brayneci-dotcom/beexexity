# Tasks — Chat History Sidebar

## Overview

Implementation is organised into **6 waves** with checkpoints between them. Waves 1–2 (types, migration, service layer) can be partially parallelised. Waves 3–4 (routes, mounting) are sequential. Wave 5 (frontend) can start once Wave 4 is done. Wave 6 (tests) runs throughout and after.

**Total estimated tasks**: 17 implementation + 5 checkpoints = 22 items.

---

## Tasks

### Wave 1 — Foundation (Types, Migration, Config)

- [ ] **Task 1: Add new types to `src/types/session.types.ts`**
  - Add `SessionWithStats` interface extending `Session` with `preview`, `totalInputTokens`, `totalOutputTokens`, `requestCount`.
  - Add `SessionStats` interface with `sessionId`, `totalInputTokens`, `totalOutputTokens`, `requestCount`, `estimatedCostUsd`, `breakdown: ModelBreakdown[]`.
  - Add `ModelBreakdown` interface with `modelId`, `inputTokens`, `outputTokens`, `requestCount`, `estimatedCostUsd`.
  - _Requirements: R5, R6_

- [ ] **Task 2: Add `modelPricingSnapshot` to `src/types/audit.types.ts`**
  - Add optional field `modelPricingSnapshot?: Record<string, number>` to `AuditEntry`.
  - _Requirements: R9_

- [ ] **Task 3: Create migration `migrations/006_audit_pricing_snapshot.sql`**
  - Add column `model_pricing_snapshot JSONB` to `audit_logs`.
  - Add partial index `idx_audit_logs_session_id ON audit_logs(session_id) WHERE status = 'success'`.
  - _Requirements: R9_

- [ ] **Task 4: Add `listPageSize` to `src/config/index.ts`**
  - Add `listPageSize` under `session` config block, reading `SESSION_LIST_PAGE_SIZE` env var with default `50`.
  - _Requirements: R5_

- [ ] **Checkpoint 1 — Verify types compile and migration applies cleanly**
  - `npx tsc --noEmit` passes.
  - Migration runs without errors against a local test DB.
  - _Verification: TypeScript compilation + manual migration test_

---

### Wave 2 — Service Layer

- [ ] **Task 5: Extend `src/services/session.service.ts` — ownership check + expiry sweep**
  - Add `getSessionById(userId, sessionId)` — fetches a session by ID, returns `null` if not found or wrong user. Does NOT throw on expired status (viewing history must work for expired sessions).
  - Add `sweepExpiredSessions(userId)` — `UPDATE sessions SET status = 'expired' WHERE user_id = $1 AND expires_at <= NOW() AND status != 'expired'`.
  - _Requirements: R5, R7, R8_

- [ ] **Task 6: Extend `src/services/session.service.ts` — list user sessions**
  - Add `listUserSessions(userId, page, pageSize)` — returns `{ sessions: SessionWithStats[], total: number }`.
  - Single function that: (a) sweeps expired, (b) counts total, (c) fetches page with lateral joins for preview + stats.
  - Preview: `LEFT(m.sanitized_content, 60)` from the chronologically first user message.
  - Stats: `SUM(input_tokens)`, `SUM(output_tokens)`, `COUNT(*)` from `audit_logs WHERE status = 'success'`.
  - _Requirements: R5_

- [ ] **Task 7: Extend `src/services/session.service.ts` — get session stats**
  - Add `getSessionStats(sessionId)` — returns `SessionStats | null`.
  - Queries `audit_logs` grouped by `(model_id, model_pricing_snapshot)`.
  - Computes `estimatedCostUsd` per model in JS by reading `inputPricePer1MTokens` / `outputPricePer1MTokens` from the snapshot JSONB.
  - Returns `null` if no successful audit log rows exist (not an error).
  - _Requirements: R6_

- [ ] **Task 8: Extend `src/services/session.service.ts` — resume session**
  - Add `resumeSession(userId, sessionId)` — returns the updated `Session`.
  - Transaction: (1) `markSessionInactive` on current active, (2) reactivate target with refreshed `last_activity_at` and `expires_at`.
  - Validates target session is not expired (throws user-facing error if so).
  - Validates target session exists and belongs to user (throws `SessionNotFoundError` if not).
  - Idempotent if already active — just returns the session.
  - _Requirements: R8_

- [ ] **Task 9: Modify `src/services/audit.service.ts` — pricing snapshot on log**
  - Add private `pricingCache` and `getPricingSnapshot(modelId)` method — lazy-loads `pricing-config.json` once, caches in memory, returns `null` on any failure.
  - In `log()`, when `entry.status === 'success'`, call `getPricingSnapshot(entry.modelId)` and write result to `model_pricing_snapshot` column.
  - Add `model_pricing_snapshot` to the INSERT column list and VALUES.
  - _Requirements: R9_

- [ ] **Checkpoint 2 — Verify service functions with unit tests**
  - `npx vitest run tests/unit/session-list.test.ts tests/unit/session-stats.test.ts tests/unit/audit-snapshot.test.ts`
  - _Verification: All new unit tests pass_

---

### Wave 3 — Route Handlers

- [ ] **Task 10: Create `src/routes/session.routes.ts` — list sessions handler**
  - `GET /` — parse `page` (default 1, min 1) and `pageSize` (default from config, min 1, max 100) from query string.
  - Call `listUserSessions()`, return JSON response.
  - Auth gating via `authMiddleware` (mounted on router, not per-handler).
  - _Requirements: R5_

- [ ] **Task 11: Create `src/routes/session.routes.ts` — get messages handler**
  - `GET /:id/messages` — validate UUID param.
  - Call `getSessionById()` to verify ownership (404 if null).
  - Call existing `getSessionMessages(sessionId)` to fetch messages.
  - Return `{ session, messages }`.
  - _Requirements: R7_

- [ ] **Task 12: Create `src/routes/session.routes.ts` — get stats handler**
  - `GET /:id/stats` — validate UUID param.
  - Call `getSessionById()` to verify ownership (404 if null).
  - Call `getSessionStats()`; if null, return stats-with-zeros (not 404 — session exists but has no requests yet).
  - _Requirements: R6_

- [ ] **Task 13: Create `src/routes/session.routes.ts` — resume handler**
  - `POST /:id/resume` — validate UUID param.
  - Call `resumeSession()`, map thrown errors to HTTP status codes:
    - `SessionNotFoundError` → 404
    - Expired session (custom error) → 400
    - DB error → 500 (sanitized)
  - Return `{ session }` on success.
  - _Requirements: R8_

- [ ] **Checkpoint 3 — Route handlers are wired and return correct shapes**
  - `npx vitest run tests/integration/session-routes.test.ts`
  - _Verification: All integration tests pass_

---

### Wave 4 — Mount Router

- [ ] **Task 14: Mount session router in `src/app.ts`**
  - Import `sessionRouter` from `./routes/session.routes.js`.
  - Add `app.use('/api/v1/sessions', sessionRouter)` — place after existing inference routes, before the global error handler.
  - Verify existing routes are unaffected: `GET /api/v1/inference/sessions/active` still works.
  - _Requirements: R5, R6, R7, R8_

- [ ] **Checkpoint 4 — Full backend integration**
  - Start dev server (`npm run dev`), test all 4 new endpoints with curl.
  - Verify existing endpoints (`/auth/login`, `/inference/generate`, `/inference/sessions/active`) still function.
  - _Verification: Manual smoke test with curl_

---

### Wave 5 — Frontend

- [ ] **Task 15: Add sidebar CSS to `public/index.html`**
  - Add CSS rules for: `.sidebar`, `.sidebar-header`, `.sidebar-list`, `.session-row`, `.session-row.active`, `.session-row-preview`, `.session-row-meta`, `.session-row-time`, `.session-row-turns`, `.session-row-tokens`, `.session-row-cost`, `.session-row-status`, `.sidebar-footer`, `.load-more-btn`, `.sidebar-error`.
  - Modify `#chat-screen` layout from `flex-direction: column` to `flex-direction: row`.
  - Wrap existing header + cost-bar + messages + input in a new `.chat-main` div (flex: 1, flex-direction: column).
  - Add responsive breakpoints: sidebar collapses to top on ≤768px, hidden on mobile collapsed state.
  - _Requirements: R1_

- [ ] **Task 16: Add sidebar HTML structure to `public/index.html`**
  - Insert `<aside class="sidebar" id="sidebar">` as the first child of `#chat-screen`, before `.chat-main`.
  - Sidebar children: `.sidebar-header` (title + toggle button), `.sidebar-list` (empty, populated by JS), `.sidebar-footer` (load-more button + error banner).
  - Wrap existing `#chat-screen` children (header, cost-bar, messages, degraded-banner, input-wrapper) in `<div class="chat-main">`.
  - _Requirements: R1_

- [ ] **Task 17: Add sidebar JS logic to `public/index.html`**
  - Add state variables: `sessionList`, `currentViewingSessionId`, `savedSessionCost`, `savedSessionTokens`, `sessionPage`, `sessionHasMore`, `isLoadingSessions`, `sidebarCollapsed`.
  - Add `loadSessions(page)` — calls `GET /api/v1/sessions?page=N`, populates `sessionList`, renders rows.
  - Add `renderSessionList()` — creates DOM rows from `sessionList`, highlights active session, shows degraded icons, computes relative timestamps, formats token counts and costs.
  - Add `viewSession(sessionId)` — if clicking active session, return to live chat. Otherwise: clear chat area, fetch messages (`GET /:id/messages`) and stats (`GET /:id/stats`), render transcript, disable input, show Resume button.
  - Add `resumeSession(sessionId)` — calls `POST /:id/resume`, updates `currentSessionId`, refreshes sidebar, enables input, resets in-memory cost tracking.
  - Add `toggleSidebar()` — collapses/expands sidebar on mobile.
  - Add `loadMoreSessions()` — increments `sessionPage`, appends rows.
  - Relative timestamp helper: `formatRelativeTime(isoString)` → "Just now", "5 min ago", "2 hours ago", "Yesterday", "3 days ago", "Jun 15".
  - Token/cost formatting: `formatCompactTokens(n)` → "1.2K", "15.7K", "1.0M". `formatCompactCost(usd)` → "Rp 0.50", "Rp 12.00", "Rp 1.5K".
  - _Requirements: R1, R2, R3_

- [ ] **Task 18: Add cost bar session-awareness JS to `public/index.html`**
  - Add `updateCostBar()` function — switches between three states based on `currentViewingSessionId` vs `currentSessionId`.
  - State 1 (viewing past session): show persisted stats from `savedSessionCost` / `savedSessionTokens`.
  - State 2 (active session): show `savedSessionCost + sessionTotal`, `savedSessionTokens.requests + sessionCosts.length`, live `current-cost` from last SSE event.
  - State 3 (no session): all zeros.
  - Modify `viewSession()` to call `updateCostBar()` after stats load.
  - Modify existing `updateSessionDisplay()` and `updateCurrentCost()` to call `updateCostBar()` (via existing call sites).
  - On resume: set `savedSessionCost` and `savedSessionTokens` from the stats response before enabling input.
  - On New Chat: reset `savedSessionCost = 0`, `savedSessionTokens = { in:0, out:0, requests:0 }`.
  - _Requirements: R10_

- [ ] **Task 19: Integrate existing New Chat button with sidebar refresh**
  - Modify `handleNewChat()` — after the existing reset call: (a) call `loadSessions(1)` to refresh sidebar, (b) set `currentViewingSessionId = null`, (c) set `savedSessionCost = 0`, (d) call `updateCostBar()`.
  - Modify `showChatScreen()` — call `loadSessions(1)` after loading active session history, so sidebar is populated on login.
  - _Requirements: R4_

- [ ] **Checkpoint 5 — Full frontend manual test**
  - Start dev server, log in as a user with session history.
  - Verify: sidebar loads with session rows, clicking a row shows transcript, Resume reactivates the session, New Chat refreshes sidebar, cost bar updates correctly in all three states.
  - Verify mobile: sidebar collapses/expands, layout stacks correctly.
  - _Verification: Manual walkthrough of all acceptance criteria_

---

### Wave 6 — Tests

- [ ] **Task 20: Write unit tests**
  - `tests/unit/session-list.test.ts` — `listUserSessions()` pagination math, preview truncation, empty list, expiry sweep side effect.
  - `tests/unit/session-stats.test.ts` — `getSessionStats()` aggregation, per-model breakdown, null pricing → null cost, zero rows → zeros.
  - `tests/unit/audit-snapshot.test.ts` — `getPricingSnapshot()` cache hit, missing config file, unknown model returns null.
  - _Requirements: R5, R6, R9_

- [ ] **Task 21: Write integration tests**
  - `tests/integration/session-routes.test.ts` — full HTTP test for each endpoint:
    - List sessions with pagination, verify 401 without token, verify 404 for foreign session.
    - Get messages, verify chronological order, verify 404 for foreign session.
    - Get stats, verify token totals match inserted audit_logs, verify cost computation.
    - Resume session, verify status change, verify old active is deactivated, verify 400 on expired.
  - _Requirements: R5, R6, R7, R8_

- [ ] **Task 22: Write property-based tests**
  - `tests/property/session-pagination.test.ts` — property CP4: generate N sessions, paginate with varying page sizes, verify all IDs collected are unique and count equals N.
  - `tests/property/session-resume-concurrency.test.ts` — property CP2: for a user with multiple inactive sessions, concurrent resume calls result in exactly one active session.
  - _Correctness Properties: CP2, CP4_

* [ ] **\*Task 23: Frontend cost bar state transition tests**
  - `tests/unit/cost-bar.test.ts` — mock the three `updateCostBar()` states, verify correct DOM element text content for each combination of `currentViewingSessionId`, `currentSessionId`, `savedSessionCost`, `sessionTotal`.
  - _Requirements: R10_ *(optional — can be deferred if testing vanilla JS DOM manipulation proves too brittle)*

---

## Task Dependency Graph

```json
{
  "waves": [
    {
      "name": "Wave 1 — Foundation",
      "parallel": ["Task 1", "Task 2", "Task 3", "Task 4"],
      "checkpoint": "Checkpoint 1"
    },
    {
      "name": "Wave 2 — Service Layer",
      "dependsOn": ["Wave 1"],
      "parallel": ["Task 5", "Task 9"],
      "sequentialAfter": [
        { "task": "Task 6", "dependsOn": ["Task 5"] },
        { "task": "Task 7", "dependsOn": ["Task 5"] },
        { "task": "Task 8", "dependsOn": ["Task 5"] }
      ],
      "checkpoint": "Checkpoint 2"
    },
    {
      "name": "Wave 3 — Route Handlers",
      "dependsOn": ["Wave 2"],
      "sequential": ["Task 10", "Task 11", "Task 12", "Task 13"],
      "checkpoint": "Checkpoint 3"
    },
    {
      "name": "Wave 4 — Mount Router",
      "dependsOn": ["Wave 3"],
      "sequential": ["Task 14"],
      "checkpoint": "Checkpoint 4"
    },
    {
      "name": "Wave 5 — Frontend",
      "dependsOn": ["Wave 4"],
      "parallel": ["Task 15", "Task 16"],
      "sequentialAfter": [
        { "task": "Task 17", "dependsOn": ["Task 15", "Task 16"] },
        { "task": "Task 18", "dependsOn": ["Task 17"] },
        { "task": "Task 19", "dependsOn": ["Task 17"] }
      ],
      "checkpoint": "Checkpoint 5"
    },
    {
      "name": "Wave 6 — Tests",
      "dependsOn": ["Wave 4"],
      "parallel": ["Task 20", "Task 21", "Task 22", "*Task 23"]
    }
  ]
}
```

### Visual Dependency Flow

```
Wave 1 (parallel)          Wave 2 (partial parallel)    Wave 3-4 (sequential)
┌─────┐                   ┌─────────────────────┐      ┌──────────────────────────┐
│ T1  │──┐                │ T5 ──┬── T6          │      │ T10 → T11 → T12 → T13   │
│ T2  │──┤    Check 1     │      ├── T7          │──▶   │              │           │
│ T3  │──┤──────▶         │      └── T8          │      │         Check 3         │
│ T4  │──┘                │ T9 ────────────────── │      └────────────┬───────────┘
└─────┘                   └──────────┬──────────┘                     │
                           Check 2   │                        Wave 4  │
                                     │                      ┌─────────▼──────────┐
                                     └──────────────────────│ T14 → Check 4      │
                                                            └─────────┬──────────┘
                                                                      │
Wave 5 (partial parallel)                                     Wave 6 (parallel)
┌──────────────────────────────┐                              ┌──────────────────────┐
│ T15 ──┐                      │                              │ T20                  │
│       ├── T17 ──┬── T18      │                              │ T21                  │
│ T16 ──┘         ├── T19      │                              │ T22                  │
│                 │             │                              │ *T23                 │
│            Check 5           │                              └──────────────────────┘
└──────────────────────────────┘
```

### Parallelism Summary

| Wave | Parallel Tasks | Reason |
|---|---|---|
| Wave 1 | T1, T2, T3, T4 | All are independent file writes — types, migration SQL, config entry |
| Wave 2 | T5 + T9, then T6/T7/T8 | T5 (session helpers) and T9 (audit snapshot) touch different files. T6/T7/T8 all depend on T5 but can run in parallel with each other |
| Wave 3 | None | All handlers in same file — sequential to avoid merge conflicts |
| Wave 4 | None | Single file change |
| Wave 5 | T15 + T16, then T18 + T19 | CSS and HTML are independent. T18 and T19 can be written in parallel (different JS functions) |
| Wave 6 | T20, T21, T22, *T23 | All test files are independent |
