# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Unified Inference Gateway — a built-in Express.js proxy/gateway to AWS Bedrock in **ap-southeast-3 (Jakarta)** for a banking application. All processing is locked to Jakarta for Indonesian data residency compliance (OJK/BI regulations).

## Behavioral Guidelines

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Feature Development Workflow

For every new feature, **follow this documentation-first process** before writing any code:

### 1. Create a Feature Folder
- Name the folder after the feature (e.g., `feature-conversation-memory/`).
- Inside it, produce three files:  
  `requirements.md`, `design.md`, `tasks.md`.

### 2. Content of Each File

#### `requirements.md`
- **Introduction** – concise overview, purpose, and high‑level constraints.
- **Glossary** – define key domain terms specific to this feature.
- **Requirements** – each is a user story with a title and acceptance criteria, formatted as:  
  > **Requirement X: Title**  
  > **User Story:** As a …, I want …, so that …  
  > **Acceptance Criteria:**  
  > 1. WHEN … THEN …  
  > 2. …  
- **Notes** – additional context, trade‑offs, or references.

#### `design.md`
- **Overview** – high‑level description of the solution, how it fits into the existing system, and the layered approach.
- **Architecture** – include diagrams (sequence, ER) using Mermaid syntax.
- **Components and Interfaces** – list each new/modified service/component with TypeScript (or relevant) interfaces and key functions.
- **Data Models** – database migrations (SQL) with indexes.
- **Configuration** – new environment variables / config entries.
- **Correctness Properties** – a list of formal properties the system should uphold (for property‑based testing later).
- **Error Handling** – table of failure scenarios, system behaviour, and user impact.
- **Testing Strategy** – unit, property‑based, and integration tests – what will be covered.

#### `tasks.md`
- **Overview** – brief summary of the implementation plan.
- **Tasks** – ordered, actionable tasks with checkboxes `- [ ]`. Each task should link to requirement(s) it fulfils (e.g., `_Requirements: 1.1, 2.3_`). Optional tasks can be marked with `*`.
- **Checkpoints** – include tasks like “Checkpoint - Ensure all tests pass” for incremental validation.
- **Task Dependency Graph** – provide a JSON structure showing waves of tasks that can be parallelised.

### 3. Process
- When a new feature is requested, **first produce these three documents**.
- Iterate on them until I approve them.
- Only after approval, start writing code following the order and detail in `tasks.md`.
- Reference the documents as the source of truth – every code change should trace back to a task/requirement.
- Keep the documents up‑to‑date if implementation reveals deviations.

### 4. Communication
- Ask clarifying questions **before** writing the documents.
- Explicitly note assumptions or open questions during document creation.
- Use the provided sample (conversation memory feature) as a reference for style and depth.

**Example prompt to start a new feature:**

> “We need to add [feature description]. Please follow the Feature Development Workflow to produce requirements.md, design.md, and tasks.md. Use the conversation memory sample as a reference for style and depth. After I approve, we'll proceed with implementation.”

---

This workflow ensures thorough planning, traceability, and quality before any code is written.




## Common Commands

```bash
npm run build          # TypeScript compilation (tsc) → dist/
npm run dev            # Development server with hot reload (tsx watch src/server.ts)
npm start              # Production server (node dist/server.js)
npm test               # Run all tests (vitest run)
npm run test:unit      # Unit tests only (vitest run tests/unit)
npm run test:property  # Property-based tests (vitest run tests/property)
npm run test:integration # Integration tests (vitest run tests/integration)
npm run test:watch     # Watch mode
npm run lint           # ESLint on src/ and tests/

# Run a single test file
npx vitest run tests/unit/pii-masker-nama.test.ts

# Seed the first admin user into the database
npx tsx scripts/seed-admin.ts
```

The server listens on `PORT` (default 3000). A `.env` file at the project root provides config — see `src/config/index.ts` for all env vars.

## Architecture

```
Client (browser)
  → Express server (src/server.ts → src/app.ts)
    → Middleware: securityHeaders → CORS → JSON parser → rateLimit
    → Routes:
        /api/v1/auth/*       (login, change-password)
        /api/v1/admin/*      (user CRUD, admin-only)
        /api/v1/models/*     (available models listing)
        /api/v1/inference/*  (generate, sessions)
    → Static files served from public/ (SPA frontend)
```

### Request Flow (Inference)

1. **Auth** → JWT validation via `authMiddleware`
2. **PII Masking** → `pii-masker.service.ts` detects Indonesian PII (NIK, phone, bank account, person names, bank names) and replaces with `[TYPE_N]` placeholders. One-way masking — masked data is never restored.
3. **Session Validation** → `getValidatedSession()` fetches or creates a session; rejects expired sessions with SSE error, not-found sessions with 404.
4. **Turn Lock** → In-memory `Map<string, boolean>` prevents concurrent turns on the same session (409 if busy).
5. **Message Storage** (fail-fast) → User message persisted to `messages` table BEFORE calling Bedrock.
6. **Context Assembly** → `buildContext()` selects recent history messages via sliding window, respecting a character budget (default 120K chars). Produces both `inference_payload` (for Bedrock) and `routing_payload` (for the routing engine — last 2 user messages, max 500 chars).
7. **Routing Engine** → `routing-engine.service.ts`:
   - **Refinement**: Uses qwen3-32b to rewrite the raw prompt into a clearer model-facing version. Falls back to original prompt on failure.
   - **Complexity Scoring**: Uses qwen3-32b to score the prompt 1-5. Falls back to configurable default (2) on failure.
   - **Policy Resolution**: `routing-policy.service.ts` selects model. Priority: manual override → long-context → vision → text complexity bands.
   - Routing metadata is emitted as an SSE `routing` event.
8. **Inference** → `inference.service.ts` calls Bedrock `ConverseStreamCommand` with the routed model, streams SSE events (`delta`, `metadata`, `done`) to the client. Retries throttling errors (429) with exponential backoff (1s/2s/4s); fails fast on timeouts and model errors.
9. **Assistant Message Storage** → On success, sanitized assistant text is stored and `turn_count` increments. On storage failure, session transitions to `degraded` state and a `session_status` SSE event is emitted.
10. **Audit Log** → Metadata-only (no full prompt/response) fire-and-forget insert to `audit_logs` table.

### Routing Policy (Model Selection)

| Condition | Model Selected |
|---|---|
| Manual override | User-selected model |
| Long context (>8000 chars), no images | qwen3-235b (strong context handling) |
| Images, complexity 1-3 | qwen3-32b (lightweight vision) |
| Images, complexity 4 | gpt-oss-120b (stronger vision) |
| Images, complexity 5 | qwen3-235b (advanced vision) |
| Text, complexity 1-3 | qwen3-32b (fast) |
| Text, complexity 4-5 | qwen3-235b (reasoning) |

All three allowed models are in `src/types/inference.types.ts` (`ALLOWED_MODELS`). Model capabilities (vision vs text-only) are defined in `src/config/model-capabilities.ts`.

### PII Masker Details

Detects five Indonesian entity types (`src/types/pii.types.ts`):
- **NIK**: 16-digit national ID validated against province codes
- **NO_HP**: Mobile numbers (08xx, +62, 62) validated against operator prefixes
- **NO_REKENING**: 8-15 digit sequences in banking context (keywords like "rekening", "transfer ke")
- **NAMA**: Person names via title prefixes (Bapak/Ibu/Pak/etc.) and capitalized word sequences, with an exclusion list for common words
- **NAMA_BANK**: Bank names from a curated Indonesian bank dictionary with fuzzy alias matching

Detections are resolved left-to-right (longest match wins), then assigned indexed placeholders (`[NIK_1]`, `[NIK_2]`, etc.). Masking is one-way — there is no unmasking step (despite what the PRD says).

## Key Files

| File | Role |
|---|---|
| `src/server.ts` | Entry point — starts HTTP listener |
| `src/app.ts` | Express app setup — middleware stack, route mounting, error handler |
| `src/lambda.ts` | AWS Lambda handler — wraps Express via `@vendia/serverless-express` |
| `src/config/index.ts` | All configuration from env vars with defaults |
| `src/config/database.ts` | PostgreSQL connection pool (pg `Pool`) |
| `src/routes/inference.routes.ts` | Core inference endpoint with SSE streaming, session management, multipart handling |
| `src/services/inference.service.ts` | Bedrock `ConverseStream` call, retry logic, SSE event mapping |
| `src/services/routing-engine.service.ts` | Prompt refinement + complexity scoring + policy-based model routing |
| `src/services/routing-policy.service.ts` | Policy resolution — maps complexity/modality to model ID |
| `src/services/pii-masker.service.ts` | Regex/heuristic PII detection and masking |
| `src/services/session.service.ts` | Session lifecycle — create, validate, expire, degrade, messages CRUD |
| `src/services/context-assembly.service.ts` | `buildContext()` — sliding-window history selection with character budget |
| `src/services/auth.service.ts` | Login, JWT sign/verify, password change, user CRUD |
| `src/services/audit.service.ts` | Fire-and-forget audit log persistence |
| `src/middleware/auth.middleware.ts` | JWT Bearer token validation |
| `src/middleware/security.middleware.ts` | Security headers, in-memory rate limiters (login 5/15min, API 100/min, inference 20/min) |

## Database

PostgreSQL with connection pool (max 20). Schema is in `migrations/` — apply in order:
- `001_initial_schema.sql` — users, sessions, messages, audit_logs
- `002_audit_upload_fields.sql` — file metadata columns on audit_logs
- `003_gateway_enhancements.sql` — routing metadata columns on audit_logs
- `004_conversation_memory.sql` — session/message enhancements for multi-turn
- `005_session_hardening.sql` — session validation, storage flags

Seed the first admin user with `npx tsx scripts/seed-admin.ts` (creates admin/admin123).

## Deployment

Two Dockerfiles:
- **`Dockerfile`** — multi-stage Node.js Alpine build for standalone server (port 3000)
- **`Dockerfile.lambda`** — AWS Lambda container image using `public.ecr.aws/lambda/nodejs:20`

GitHub Actions (`.github/workflows/deploy-aws.yml`) deploys on push to `main`: builds `Dockerfile.lambda`, pushes to ECR, updates Lambda function. Lambda is in a VPC with private RDS, exposed via Function URL with response streaming enabled.

Infrastructure setup script: `infra/deploy-setup.sh` — one-time provisioning of VPC, security groups, RDS, ECR, Lambda, and Function URL. Run from `infra/` directory.

## Testing

Tests use **Vitest** with `@/` path alias mapped to `src/`. Test files mirror the source structure under `tests/unit/`. Some tests use `fast-check` for property-based testing. Test coverage excludes `src/server.ts` (entry point).

## Important Patterns

- **Fail-closed PII masking**: If the PII masker throws, the inference is rejected (500) rather than sending unmasked data to Bedrock.
- **Graceful degradation**: Routing engine failures fall back to the default model (`qwen.qwen3-32b-v1:0`). Audit log failures are silently caught (fire-and-forget). Assistant message storage failure transitions the session to `degraded` state.
- **Turn lock**: An in-memory `Map` (not distributed) prevents concurrent turns on the same session. Released in a `finally` block.
- **No full content logging**: Audit logs record metadata only (model, tokens, duration, routing decision). Never store prompt or response content.
- **Sanitized errors**: AWS Bedrock errors are sanitized before reaching the client — no ARNs, request IDs, or stack traces exposed.
