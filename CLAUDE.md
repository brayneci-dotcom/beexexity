# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Unified Inference Gateway — a built-in Express.js proxy/gateway to AWS Bedrock in **ap-southeast-3 (Jakarta)** for a banking application. All processing is locked to Jakarta for Indonesian data residency compliance (OJK/BI regulations).

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
