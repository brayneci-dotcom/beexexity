# Tech Reference: Beexexity — Unified Inference Gateway

> For code review & evaluation. Covers architecture, tech stack, routing, memory, and all subsystems.

---

## 1. Tech Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| Runtime | Node.js | 20 (Alpine in Docker) |
| Language | TypeScript | 5.6+, `NodeNext` module resolution |
| Framework | Express.js | 4.21+ |
| Database | PostgreSQL | pg Pool (max 20), SSL via `rejectUnauthorized: false` |
| AI Models | AWS Bedrock | ap-southeast-3 (Jakarta) only |
| Bedrock SDK | `@aws-sdk/client-bedrock-runtime` | ^3.700 |
| Document parsing | `pdf-parse`, `mammoth`, `officeparser`, `cheerio`, `xlsx`, `turndown` + GFM | PDF, DOCX, PPTX, XLSX, HTML, Markdown output |
| Office conversion | Gotenberg (sidecar Cloud Run service) | .doc, .ppt → PDF → text |
| Auth | JWT (`jsonwebtoken`) + bcrypt + Google OAuth (`google-auth-library`) | HS256, local + Google sign-in |
| File uploads | `multer` | Memory storage, 10MB/file, max 5 files |
| Testing | Vitest | `@/` alias → `./src/*` |
| Linting | ESLint 9 + `typescript-eslint` | Flat config |
| Build | `tsc` | Output: `dist/` |
| Dev server | `tsx watch` | Hot reload |
| Property testing | `fast-check` | For PII masker |

### Deployment targets

| Target | Config | Notes |
|---|---|---|
| GCP Cloud Run | `Dockerfile` + `cloudbuild.yaml` | Artifact Registry + Secret Manager, `asia-southeast2` |
| Local dev | `npm run dev` | `.env` at root, `npx tsx` |

---

## 2. Code Layout

```
src/
├── server.ts              # HTTP listener entry
├── app.ts                 # Express app: middleware stack, routes, error handler, /health
├── config/
│   ├── index.ts           # All env-var config with defaults
│   ├── database.ts        # pg Pool + query() helper + closePool()
│   └── model-capabilities.ts  # Static model→capability registry
├── middleware/
│   ├── auth.middleware.ts       # JWT Bearer validation
│   ├── admin.middleware.ts      # Admin role guard
│   ├── password-reset.middleware.ts  # Force password reset gate
│   ├── security.middleware.ts       # Security headers, rate limiters (login/API/inference)
│   └── upload.middleware.ts         # Multer config, MIME whitelist, error handler
├── routes/
│   ├── auth.routes.ts        # POST /login, POST /google, GET /google/config, POST /change-password
│   ├── admin.routes.ts       # POST|PUT /users, GET /usage/cost, POST /users/bulk
│   ├── models.routes.ts      # GET / (available models)
│   ├── inference.routes.ts   # POST /generate (JSON + multipart), GET /sessions/active, POST /sessions/reset
│   └── session.routes.ts     # GET /, GET /:id/messages, GET /:id/stats, POST /:id/resume
├── services/
│   ├── auth.service.ts           # Login, JWT sign/verify, user CRUD, Google OAuth (loginWithGoogle)
│   ├── subagent-orchestrator.service.ts  # Plan → execute → synthesize multi-agent pipeline
│   ├── subagent-executor.service.ts      # Parallel sub-agent execution with concurrency limit
│   ├── subagent-synthesizer.service.ts   # Merge sub-agent results, per-agent token budget guard
│   ├── session.service.ts        # Session lifecycle, messages CRUD, stats
│   ├── inference.service.ts      # Bedrock ConverseStream/Converse/InvokeModel, retry, SSE, OCR, repair
│   ├── routing-engine.service.ts # 17-skill classifier, refinement, scoring, policy, verification
│   ├── routing-policy.service.ts # Model selection: manual→long→vision→text
│   ├── pii-masker.service.ts     # Indonesian PII detection (NIK, HP, rekening, nama, bank)
│   ├── context-assembly.service.ts    # Sliding window, char budget, routing_payload, summary+facts injection
│   ├── session-memory.service.ts      # Load memory state, summarize evicted, extract facts
│   ├── content-builder.service.ts      # Ordered content blocks for Bedrock Converse
│   ├── document-extractor.service.ts   # PDF, DOCX, PPTX, XLSX, HTML, JSON, CSV, TXT, MD, XML (output: Markdown)
├── gotenberg.service.ts            # Legacy Office (.doc, .ppt) → PDF → text via Gotenberg
│   ├── prompts/
│   ├── subagent-planner.prompt.ts    # Planner LLM system prompt (opt-out contract)
│   └── subagent-synthesis.prompt.ts  # Synthesis LLM system prompt
├── image-processor.service.ts      # Image buffer → base64 content block
│   ├── upload-validator.service.ts     # Classify files → documents/images, MIME checks
│   ├── audit.service.ts                # Fire-and-forget audit logs + pricing snapshots
│   ├── cost-reporting.service.ts       # Per-user cost aggregation
├── few-shot-library.ts             # Per-skill golden examples for format adherence
├── session-memory.service.ts       # Load memory state, summarize evicted, extract facts
├── gotenberg.service.ts            # Legacy Office (.doc, .ppt) → PDF → text via Gotenberg
└── file-signature-validator.ts     # Magic byte heuristic gate
├── frontend/
│   ├── cost-display.ts          # IDR rate fetch, session cost tracking
│   └── pricing-config.json      # Per-model pricing (input/output per 1M tokens)
├── types/
│   ├── auth.types.ts
│   ├── session.types.ts         # Session, StoredMessage, BedrockMessage, AssembledContext, SessionStats
│   ├── inference.types.ts       # InferenceRequest, InferenceResult, RoutingMetadataEvent, ModalityFlags
│   ├── routing.types.ts         # RoutingInput, RoutingDecision, PromptContract, PolicyInput, SkillType
│   ├── pii.types.ts
│   ├── upload.types.ts          # DocumentFile, ImageFile, ExtractionResult, ContentBuildInput, ContentBlock
│   ├── subagent.types.ts       # SubAgentSpec, SubAgentResult, OrchestrationMeta
│   ├── audit.types.ts
│   ├── pricing.types.ts
│   ├── reporting.types.ts
│   └── error.types.ts
└── scripts/
    └── run-migrations.ts    # Idempotent migration runner (creates _migrations table)
migrations/
├── 001_initial_schema.sql
├── 002_audit_upload_fields.sql
├── 003_gateway_enhancements.sql
├── 004_conversation_memory.sql
├── 005_session_hardening.sql
├── 006_audit_pricing_snapshot.sql
├── 007_session_memory.sql          # rolling_summary, memory_version
├── 008_session_facts.sql           # extracted_facts JSONB
└── 009_add_group_name.sql          # group_name on users
tests/
└── unit/                           # 24 test files mirror src/ structure
scripts/
├── seed-admin.ts                   # Creates admin/admin123
└── (vendor scripts)
public/
├── index.html                      # SPA frontend (inference chat)
└── admin.html                      # Admin dashboard (user mgmt, cost, settings)
infra/
├── README.md                       # Architecture docs (Cloud Run → Bedrock → RDS)
└── gcp-setup.sh                    # One-time GCP Cloud Run provisioning
```

---

## 3. Request Lifecycle (Full End-to-End)

### 3.1 Text-only JSON inference

```
Client → POST /api/v1/inference/generate
  Body: { prompt, modelId?, config? }
  
  1. authMiddleware           — JWT validation, attach req.user
  2. forcePasswordResetMiddleware — check flag
  3. inferenceRateLimit       — 20 req/min per IP
  4. Validate prompt          — non-empty, < 64K chars
  5. Validate modelId         — ALLOWED_MODELS or default
  6. PII mask prompt          — fail-closed: 500 if throws
  7. Prompt length check      — < maxContextCharacters
  8. Session validation       — getValidatedSession() (create or resume)
  9. Turn lock                — prevent concurrent turns on same session
  10. Store user message      — fail-fast: 500 if DB fails
  11. Load session messages
  12. Load memory state       — rolling_summary + extracted_facts
  13. buildContext()          — sliding window, char budget, inject summary+facts
      → inference_payload    — BedrockMessage[]
      → routing_payload      — last 2 user msgs + last assistant, ≤ 500 chars
      → evictedMessages[]    — for summary refresh
  14. Routing engine (auto mode):
      a. classifyRequestType()   — 17 skills via qwen3-32b
      b. refinePrompt()          — skill-specific, includes conversationContext
      c. scoreComplexity()       — 1-5, includes conversationContext
      d. resolvePolicy()         — model selection
      → routingDecision          — model, refined prompt, contract, timing
  15. Emit SSE events:
      event: session      { sessionId }
      event: routing      { refinedPrompt, confidence, skill, flags, timing, memory, context }
  16. Inject few-shot examples  — getFewShotExamples(skill), prepended before current prompt
  17. buildContext() → conversationMessages (history + few-shot + refined prompt)
  18. generate()           — Bedrock ConverseStream, SSE delta/metadata/done
  19. verifyOutput()       — deterministic checks against PromptContract
  20. Semantic verification — semanticJudge() for compliance/logic/doc_qna/code skills
       → event: semantic_verdict (if failed)
  21. Auto-repair (if verification or semantic fails) — repairResponse() → event: repair
  22. Store assistant msg  — PII-masked, increment turnCount
  23. Extract facts        — extractFacts() → update extracted_facts JSONB
  24. Audit log            — metadata-only, fire-and-forget
  25. Memory update        — if messages evicted, summarizeEvicted() → rolling_summary
  26. Release turn lock
```

### 3.2 Multipart inference (with file uploads)

```
Same as JSON flow, with additions:
  5b. UploadMiddleware      — multer, memory storage, MIME filter
  5c. Validate & classify   — split into documents/images
  5d. Check model vision    — if images, must be vision-capable model
  5e. Extract document text — format-aware extractor
  5f. PII mask extracted text
  5g. Build content blocks  — text → document labels → document blocks → images
  5h. Routing               — includes maskedDocumentText, hasImages
  5i. Two-stage OCR (if needsOCR):
      Stage 1: Nova Lite via InvokeModel (raw API, messages-v1 schema)
      Stage 2: GPT-OSS 120B enhances OCR output
  5j. Generate              — with enhanced model
       ╰── If enhance model fails → auto-fallback to original routing model (qwen3-235b)
```

---

## 4. Routing Engine

### 4.1 Architecture — Full `routeRequest(input)` Walkthrough

#### Input (`RoutingInput`)

```typescript
interface RoutingInput {
  originalPrompt: string;           // PII-masked user prompt
  maskedDocumentText?: string;      // PII-masked extracted document text
  hasImages: boolean;
  imageModelRequired: boolean;
  routingState: 'auto' | 'manual';
  manualModelId?: string;           // Set when user manually selects a model
  userId: string;
  conversationContext?: string;     // Last 2 user messages + last assistant, ≤ 500 chars
}
```

#### Output (`RoutingDecision`)

```typescript
interface RoutingDecision {
  executedModelId: string;
  routingState: 'auto' | 'manual';
  complexityScore: number;          // 1-5
  scoreBand: 'direct-answer' | 'moderate-reasoning' | 'advanced-reasoning';
  confidence: number;               // 0.0-1.0 from scoring LLM
  refinedPrompt: string;            // Skill-refined prompt or original fallback
  routingReasonCode: string;        // Policy reason: 'complexity-3', 'vision-complexity-2', 'manual-override', etc.
  reasoningSummary: string;         // Human-readable: "skill=email → moderate-reasoning, text-only"
  modalityFlags: ModalityFlags;     // { textOnly, documentText, image, mixed }
  manualOverrideApplied: boolean;
  flags: string[];                  // Warnings: ['refinement-failed', 'scoring-failed', 'routing-context-used']
  skill: SkillType;                 // 1 of 17 classified skills
  contract: PromptContract | null;  // Structured refinement output
  routingDurationMs?: number;       // Total wall-clock time for all routing steps
  classificationDurationMs?: number;
  refinementDurationMs?: number;
  scoringDurationMs?: number;
}
```

#### Step-by-step process

```
routeRequest(input)
│
├── [GUARD] routingState === 'manual'?
│     ├── resolvePolicy({ manual: true, manualModelId }) → modelId
│     └── return RoutingDecision (no refinement/scoring — instant)
│
└── routingState === 'auto'?
      │
      ├── 1. BUILD MODALITY FLAGS
      │     ├── textOnly = !maskedDocumentText && !hasImages
      │     ├── documentText = !!maskedDocumentText && !hasImages
      │     ├── image = hasImages && !maskedDocumentText
      │     └── mixed = hasImages && !!maskedDocumentText
      │
      ├── 2. CLASSIFY REQUEST TYPE  (classifyRequestType)
      │     ├── Silent upload (empty prompt + files)? → hardcode 'document_qna'
      │     ├── Normal? → qwen3-32b, maxTokens=50, temperature=0
      │     │     ├── System: "Classify into ONE of 17 categories"
      │     │     ├── Truncated to first 1000 chars
      │     │     ├── Timeout: classifierTimeoutMs (default 2000ms)
      │     │     └── Output matched against ALL_SKILLS list → SkillType
      │     └── Failure? → fallback to 'general'
      │
      ├── 3. PROMPT REFINEMENT  (refinePrompt)
      │     ├── Selects skill-specific system prompt from SKILL_PROMPTS[skill]
      │     ├── Calls qwen3-32b, maxTokens=1024, temperature=0.3
      │     ├── Timeout: refinementTimeoutMs (default 8000ms)
      │     ├── Input includes conversationContext (last user+assistant turns)
      │     │     Allows the refinement LLM to connect follow-up prompts
      │     │     (e.g. "make it in english" → knows previous response was in French)
      │     ├── Output parsed as JSON → PromptContract { role, context, task, intent, ambiguities, format?, constraints? }
      │     │     Also produces a flowing-text version (backward compat)
      │     │     Handles markdown-wrapped JSON (```json ... ```)
      │     ├── Success? → use refinedPrompt + contract
      │     └── Failure? → push 'refinement-failed' flag, use original prompt
      │
      ├── 4. COMPLEXITY SCORING  (scoreComplexity)
      │     ├── Calls qwen3-32b, maxTokens=64, temperature=0.1
      │     ├── Timeout: scoringTimeoutMs (default 5000ms)
      │     ├── Input: refined prompt + conversationContext + documentText + skill
      │     │     conversationContext calibrates score for follow-up turns
      │     ├── Output: JSON { score: 1-5, confidence: 0.0-1.0 }
      │     ├── Success? → use score + confidence
      │     └── Failure? → push 'scoring-failed' flag, use defaultFallbackScore (2), confidence=0.5
      │
      ├── 5. LONG CONTEXT CHECK
      │     ├── totalInputLength = originalPrompt.length + maskedDocumentText.length
      │     └── isLongContext = totalInputLength > longContextThreshold (default 8000)
      │
      ├── 6. POLICY RESOLUTION  (resolvePolicy)
      │     ├── Priority order:
      │     │     1. Manual state           → user-selected model
      │     │     2. Long context, no image → qwen3-235b (256K context window)
      │     │     3. Image, score 1-3       → openai.gpt-oss-120b-1:0
      │     │     4. Image, score 4-5       → qwen3-235b
      │     │     5. Text (any score)       → qwen3-235b
      │     ├── Each returns modelId + reasonCode (e.g. 'complexity-3', 'vision-complexity-4')
      │     └── Failure? → push 'policy-failed' flag, fallback to qwen3-32b
      │
      ├── 7. BUILD REASONING SUMMARY
      │     ├── Template: "skill={skill} → complexity band {scoreBand}"
      │     ├── + "long-context override" if isLongContext
      │     ├── + modality description (text-only / image / document-text / mixed)
      │     └── + flags if any: "flags: [refinement-failed, routing-context-used]"
      │
      └── 8. RETURN RoutingDecision
            ├── executedModelId        — from policy
            ├── complexityScore        — from scoring step
            ├── scoreBand              — mapped: 1→direct-answer, 2-3→moderate-reasoning, 4-5→advanced-reasoning
            ├── confidence             — from scoring LLM
            ├── refinedPrompt          — refined or original
            ├── routingReasonCode      — from policy
            ├── reasoningSummary       — human-readable string
            ├── modalityFlags          — from step 1
            ├── manualOverrideApplied  — false (auto mode)
            ├── flags                  — accumulated warnings
            ├── skill                  — classified skill
            ├── contract               — PromptContract or null
            ├── routingDurationMs      — Date.now() - routingStart
            ├── classificationDurationMs
            ├── refinementDurationMs
            └── scoringDurationMs
```

#### Timing capture

Each step records `Date.now()` at start and end. The durations flow into the `routing` SSE event for the thought process display. Steps that don't run (classification skipped for silent uploads) leave the duration `undefined`.

#### Fallback chain

```
Classification failure  → skill = 'general'
Refinement failure      → original prompt used, 'refinement-failed' flag
Scoring failure         → default score (2), confidence (0.5), 'scoring-failed' flag
Policy failure          → qwen3-32b fallback, 'policy-failed' flag
```

All four steps can fail independently. The accumulated `flags[]` array exposes exactly which steps fell back, enabling debugging and monitoring.

### 4.2 The 17 Skills (5 groups)

```
Generation:    email | creative | brainstorming | meta_prompting
Transformation: summarization | translation | data_conversion | editing_critique
Interaction:   roleplay | logic_math | planning_strategy | document_qna
Enterprise:    requirement_generation | compliance_pre_assessment
Engineering:   code | log_troubleshooting | general (catch-all)
```

Each skill has a dedicated system prompt for `refinePrompt()` that instructs qwen3-32b to produce structured JSON: `{ role, context, task, intent, ambiguities, clarification_needed, format?, constraints? }`. The output is parsed into a `PromptContract` and a flowing-text version (backward compat).

Classification runs via qwen3-32b (maxTokens=50, temperature=0). If it fails, falls back to `general`. Silent uploads (files but no prompt) skip classification and hardcode `document_qna`.

### 4.3 Routing Policy

```
resolvePolicy(input):
  1. Manual state        → honor user's selected model
  2. Long context        → qwen.qwen3-235b-a22b-2507-v1:0
  3. Vision + score 1-3  → openai.gpt-oss-120b-1:0
  4. Vision + score 4-5  → qwen.qwen3-235b-a22b-2507-v1:0
  5. Text (any score)    → qwen.qwen3-235b-a22b-2507-v1:0
```

**Key invariant**: qwen3-32b is NEVER used for inference — it is reserved for routing engine tasks (classification, refinement, scoring).

### 4.4 Allowed Models

| Model ID | Vision | Context Window | Role |
|---|---|---|---|
| `amazon.nova-lite-v1:0` | Yes | — | OCR extraction via InvokeModel |
| `openai.gpt-oss-120b-1:0` | Yes | 128K | Vision inference (low-mid complexity) |
| `qwen.qwen3-235b-a22b-2507-v1:0` | Yes | 256K | Primary inference (all text, high-complexity vision) |
| `qwen.qwen3-32b-v1:0` | Yes | — | Routing engine only + summary generation + fact extraction |

---

## 5. Session Memory (Three-Tier)

### Tier 1: Raw Recent Turns
- All messages stored in `messages` table per session
- `buildContext()` selects last N messages within char budget (default 640K)
- Default 20 turns max (`maxHistoryTurns`)

### Tier 2: Rolling Summary
- When messages are evicted from the window, `summarizeEvicted()` calls qwen3-32b to generate/update a rolling summary
- Summary is injected into the first history message's text as `[Previous conversation summary: ...]`
- Stored in `sessions.rolling_summary TEXT`
- Version tracked via `sessions.memory_version INT`

### Tier 3: Extracted Facts
- After each successful turn, `extractFacts()` calls qwen3-32b to extract key-value pairs
- Example: `{"budget": "50M IDR Q3", "deadline": "Sep 30", "approver": "Budi"}`
- Merged with existing facts (new values overwrite old for same key)
- Injected alongside summary as `[Extracted facts: budget=50M...]`
- Stored in `sessions.extracted_facts JSONB`

### Memory State Loading
```typescript
// Loaded before every buildContext() call
const memoryState = await loadMemoryState(sessionId);
// Returns: { summary: string|null, memoryVersion: number, facts: Record<string,string> }
```

---

## 6. SSE Events Emitted During Inference

| Event | Timing | Data |
|---|---|---|
| `session` | Start of stream | `{ sessionId }` |
| `routing` | After routing | Full `RoutingMetadataEvent` |
| `delta` | Per token | `{ type: "text", content: "<token>" }` |
| `metadata` | End of stream | `{ inputTokens, outputTokens }` |
| `verification` | After generate | `{ passed, violations, checks }` |
| `semantic_verdict` | After semantic judge | `{ is_correct, missing_elements[] }` |
| `repair` | After verification/judge failure | `{ text: "<repaired content>" }` |
| `session_status` | On storage failure | `{ sessionId, is_degraded: true }` |
| `done` | End of stream — clears streaming flag immediately | `{}` |
| `error` | On failure | `{ error, message }` |

---

## 7. Verification & Repair

Two verification layers: deterministic + semantic. Both feed into the same repair pipeline.

### Layer 1: Deterministic (`verifyOutput`)
- Empty output detection
- PII placeholder leakage (`[NIK_1]`, `[NAMA_2]` etc. in response)
- Word count limits from `contract.constraints`
- Required sections from `contract.format.mustInclude`
- Forbidden content from `contract.format.mustAvoid`

### Layer 2: Semantic (`semanticJudge`)
- LLM-as-a-judge: calls qwen3-32b (maxTokens=256, temperature=0) to verify factual accuracy
- Only runs for high-stakes skills: `compliance_pre_assessment`, `logic_math`, `document_qna`, `code`
- Returns `{ is_correct: boolean, missing_elements: string[] }`
- Emitted as `event: semantic_verdict` SSE
- Judge failures feed into the repair pipeline

### Auto-repair (`repairResponse`)
- When either verification layer finds error-severity violations, `repairResponse()` calls Bedrock Converse with a system prompt targeting only the violated parts
- Original conversation messages are preserved; repair prompt says "fix ONLY these specific issues"
- Repair output is emitted as `event: repair` SSE
- Frontend displays repair in a highlighted box

### Flow
```
generate() → verifyOutput() (deterministic)
          → semanticJudge() (LLM-as-a-judge, skill-gated)
          → if any failed → repairResponse() → event: repair
```

---

## 8. Document Extraction Pipeline

### Format dispatch

```
extractDocumentText(file)
├── application/pdf                                                                  → extractPdfText() (raw text)
├── application/vnd.openxmlformats-officedocument.wordprocessingml.document          → extractDocxText() (mammoth→HTML→turndown→Markdown)
├── application/vnd.openxmlformats-officedocument.presentationml.presentation        → extractPptxText() (officeparser raw text)
├── application/vnd.openxmlformats-officedocument.spreadsheetml.sheet                → extractXlsxText() (SheetJS→Markdown tables)
├── application/vnd.ms-excel                                                         → extractXlsxText() (XLS fallback)
├── application/msword                                                               → convertViaGotenberg() (LibreOffice→PDF→text)
├── application/vnd.ms-powerpoint                                                    → convertViaGotenberg() (LibreOffice→PDF→text)
├── text/html                                                                        → extractHtmlText() (cheerio raw text)
├── application/json                                                                 → extractJsonText() (prettified + ```json block)
├── text/csv                                                                         → extractCsvText() (Markdown table, ≤500 rows)
├── text/markdown                                                                    → extractMarkdownText() (as-is)
├── text/plain                                                                       → extractPlainText() (as-is)
├── application/xml | text/xml                                                       → extractXmlText() (stripped text)
└── anything else                                                                    → throw
```

### Sanitization rules

| Format | Security measure |
|---|---|
| PDF | `pdf-parse` safe parser |
| DOCX | `mammoth` safe parser |
| PPTX | `officeparser` text-only extraction |
| HTML | Cheerio DOM: strip script/style/iframe/embed/object/form/meta. Strip event handlers `on*=`. Strip all attributes. Extract `$('body').text()`. |
| JSON | Reject `__proto__`/`constructor` keys. Reject depth > 20. |
| CSV | Strip BOM. Reject NULL bytes. Cap rows at 100K. |
| TXT | Strip BOM. Reject NULL bytes. |
| XML | Reject DOCTYPE/ENTITY (XXE). Strip processing instructions `<?...?>`. Strip tags. |

### Signature validation (`file-signature-validator.ts`)

Heuristic gate — checks first bytes against declared MIME. Not a full trust boundary. Rejects obvious spoofs (e.g. `.exe` renamed `.pdf`).

| Format | Magic bytes |
|---|---|
| PDF | `%PDF` offset 0 |
| DOCX/PPTX | `PK\x03\x04` offset 0 (ZIP) |
| PNG | `\x89PNG` offset 0 |
| JPEG | `\xFF\xD8\xFF` offset 0 |
| WEBP | `RIFF` offset 0 + `WEBP` offset 8 |
| Text formats | No magic bytes — pass through (validated by extractor) |

### Confidence scoring

| Condition | Confidence |
|---|---|
| Extracted > 100 chars | `high` |
| Extracted 0–100 chars | `low` → triggers OCR fallback pipeline |
| PPTX with only titles, no body | `medium` |
| Any extraction that throws | Throw (fail-closed) |

Low-confidence documents trigger the two-stage OCR pipeline (Nova Lite → GPT-OSS 120B).

---

## 9. Two-Stage OCR Pipeline

```
needsOCR = images.length > 0 || documentBlocks.length > 0

if needsOCR:
  Stage 1: Nova Lite via InvokeModel (raw API, messages-v1 schema)
           - Processes image blocks + raw document blocks
           - Timeout: 60s
           - maxTokens: 4096
  
  Stage 2: GPT-OSS 120B enhances OCR output
           - Combines original prompt + OCR text
           - Full streaming response to client
  
  Fallback: If Nova fails or returns empty, GPT-OSS handles natively

  Model fallback on failure:
  If GPT-OSS 120B (enhance model) is not accessible, auto-fallback to original routing model:
  ```
  generate(GPT-OSS) → FAILS → retry generate(qwen3-235b) → succeeds
  ```
  No SSE error emitted — happens transparently.
```

---

## 10. Gotenberg — Legacy Office Conversion

### Purpose
Convert binary Office formats (.doc, .ppt) that pure Node.js cannot parse. Deployed as a separate Cloud Run service.

### Flow
```
.doc / .ppt file uploaded
  → extractDocumentText() routes to convertViaGotenberg()
  → POST file to Gotenberg /forms/libreoffice/convert
  → Gotenberg returns PDF
  → extractPdfText() extracts text from PDF
  → Text returned as ExtractionResult
```

### Deployment
| Setting | Value |
|---|---|
| Image | `gotenberg/gotenberg:8` |
| Resources | 2 vCPU / 4GB RAM |
| Endpoint | `/forms/libreoffice/convert` |
| Env var | `GOTENBERG_URL` (set in Cloud Run) |

### Graceful degradation
If `GOTENBERG_URL` is not configured or the service is unreachable, returns `{ confidence: 'low', isEmpty: true }`. Never throws.

---

## 11. PII Masker

### Detected entities

| Entity | Pattern | Validation |
|---|---|---|
| NIK | 16-digit | Province code check |
| NO_HP | 08xx, +62, 62 | Operator prefix validation |
| NO_REKENING | 8-15 digit in banking context | Keyword proximity (rekening, transfer, etc.) |
| NAMA | Capitalized words after title prefixes | Exclusion list for common words |
| NAMA_BANK | Bank name dictionary | Fuzzy alias matching |

### Behavior
- Left-to-right resolution, longest match wins
- Indexed placeholders: `[NIK_1]`, `[NIK_2]`, etc.
- One-way masking — no unmasking step
- Fail-closed: if masker throws, inference rejected with 500
- Applied to both user prompt and assistant response (post-inference)

---

## 12. Database Schema

### `users`
- `google_id VARCHAR(255) UNIQUE` — Google OIDC sub claim (nullable)
- `auth_provider VARCHAR(16)` — `'local'` or `'google'`, default `'local'`
- `password` is now nullable — null for Google-authenticated users
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| username | VARCHAR(255) | UNIQUE |
| password | VARCHAR(255) | bcrypt hash |
| role | VARCHAR(50) | 'admin' \| 'user' |
| display_name | VARCHAR(255) | |
| force_password_reset | BOOLEAN | Default false |
| group_name | VARCHAR(255) | Organizational group, e.g. "IT Business Enablement" |
| created_at / updated_at | TIMESTAMPTZ | |

### `sessions`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users |
| status | VARCHAR(20) | active \| degraded \| inactive \| expired |
| turn_count | INTEGER | |
| rolling_summary | TEXT | Nullable. Tier 2 memory |
| memory_version | INTEGER | Default 0 |
| extracted_facts | JSONB | Default `{}`. Tier 3 memory |
| created_at / updated_at / last_activity_at / expires_at | TIMESTAMPTZ | |

### `messages`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| session_id | UUID | FK → sessions |
| role | VARCHAR(20) | 'user' \| 'assistant' |
| sanitized_content | TEXT | PII-masked |
| storage_flags | JSONB | `{ piiMasked, assistantSanitized, partiallyPersisted }` |
| created_at | TIMESTAMPTZ | |

### `audit_logs`
- `orchestration_meta JSONB` — sub-agent orchestration metadata (specs, results, timing)
  — Only present when orchestrator runs (multiStep triggered)
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| timestamp | TIMESTAMPTZ | |
| user_id, username | | Denormalized |
| model_id | VARCHAR(255) | |
| input_tokens, output_tokens | INTEGER | |
| status | VARCHAR(20) | 'success' \| 'failed' |
| error_category | VARCHAR(50) | Nullable |
| duration_ms | INTEGER | |
| session_id | UUID | Nullable |
| file metadata | JSONB | file_count, mime_types, total_file_size |
| routing metadata | JSONB | routing_state, complexity_score, reason_code, flags |
| model_pricing_snapshot | JSONB | Snapshot at request time |

---

## 13. Configuration (Environment Variables)

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `JWT_SECRET` | — | HS256 secret |
| `JWT_EXPIRES_IN` | 3600 | Token TTL (seconds) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | localhost/5432/bedrock_gateway/postgres/— | PostgreSQL |
| `DB_SSL` | — | Set to 'false' to disable SSL |
| `AWS_REGION` | ap-southeast-3 | Bedrock region |
| `MAX_CONTEXT_CHARACTERS` | 640000 | Character budget for context window |
| `MAX_HISTORY_TURNS` | 20 | Max turns in sliding window |
| `SESSION_EXPIRY_HOURS` | 24 | Session TTL |
| `ROUTING_METADATA_ENABLED` | true | Emit routing SSE event |
| `ROUTING_LONG_CONTEXT_THRESHOLD` | 8000 | Char threshold for long-context override |
| `ROUTING_SCORING_TIMEOUT_MS` | 5000 | Complexity scoring timeout |
| `ROUTING_REFINEMENT_TIMEOUT_MS` | 8000 | Prompt refinement timeout |
| `ROUTING_DEFAULT_FALLBACK_SCORE` | 2 | Default complexity on scoring failure |
| `EXTRACTION_LOW_CONFIDENCE_THRESHOLD` | 100 | Chars below which confidence = 'low' |
| `EXTRACTION_MAX_JSON_DEPTH` | 20 | Max JSON nesting |
| `EXTRACTION_MAX_HTML_DEPTH` | 100 | Max HTML nesting |
| `EXTRACTION_MAX_CSV_ROWS` | 100000 | Max CSV rows |
| `EXTRACTION_MAX_PPTX_ENTRIES` | 2000 | Max PPTX ZIP entries |
| `GOTENBERG_URL` | — | Gotenberg service URL for legacy Office conversion (.doc, .ppt) |
| `GOTENBERG_TIMEOUT_MS` | 30000 | Gotenberg conversion timeout |

---

## 14. Testing

### Test runner
- Vitest with `globals: true`
- Path alias `@/` → `./src/`

### Test patterns
- **Service tests**: mock database via `vi.mock('../../src/config/database.js')`, mock Bedrock via `vi.mock('@aws-sdk/client-bedrock-runtime')`
- **Pure function tests**: `context-assembly`, `content-builder`, `pii-masker` — no mocking needed
- **Route tests**: use `vi.mock` for all dependencies

### Test files (24 total)
```
tests/unit/
├── admin.middleware.test.ts
├── app.test.ts
├── audit.service.test.ts
├── auth.middleware.test.ts
├── auth.routes.test.ts
├── auth.service.test.ts
├── content-builder.test.ts
├── context-assembly.service.test.ts
├── cost-calculator.test.ts
├── cost-reporting.routes.test.ts
├── cost-reporting.service.test.ts
├── document-extractor.test.ts          # All 12 formats + security edge cases
├── file-signature-validator.test.ts    # NEW: magic byte checks
├── image-processor.test.ts
├── inference-retry.test.ts
├── inference.routes.test.ts
├── inference.service.test.ts
├── models.routes.test.ts
├── password-reset.middleware.test.ts
├── pii-detection.test.ts
├── pii-masker-nama.test.ts
├── session-memory.test.ts             # NEW: summary + facts
└── session.service.test.ts            # (referenced, path may differ)
```

### Coverage
- Excludes `src/server.ts` (entry point)
- Run: `npx vitest run`
- Single file: `npx vitest run tests/unit/pii-masker-nama.test.ts`

---

## 15. Important Patterns

- **Fail-closed PII**: If masker throws, inference rejected (500). Never sends unmasked data.
- **Graceful degradation**: Routing step failures fall back gracefully (classifier → 'general', refinement → original prompt, scoring → default 2, policy → qwen3-32b). Audit log failures silently caught.
- **Distributed turn lock**: PostgreSQL advisory lock via `pg_try_advisory_lock()` prevents concurrent turns on the same session across all Cloud Run instances sharing the same RDS. Released in `finally` block via `pg_advisory_unlock()`. Lock key derived from session UUID (first 8 hex chars → int4). Non-blocking: returns 409 immediately if lock cannot be acquired. Automatically released on connection close (crash-safe).
- **No full content logging**: Audit logs record metadata only. Never store prompt or response content.
- **Sanitized errors**: Bedrock errors sanitized — no ARNs, request IDs, or stack traces.
- **Pricing snapshots**: Model pricing captured at inference time for historical accuracy, independent of future pricing changes.
- **File buffer cleanup**: After multipart inference, file buffers explicitly nullified for GC.
- **Memory cleanup**: Turn lock is released before async memory operations (summary, facts) complete. Since the lock is now distributed (PostgreSQL advisory lock), the stale-read race condition is eliminated — the next turn cannot begin until the previous turn fully releases the lock.
- **MIME + signature**: Magic byte check is a heuristic gate, not a trust boundary. Structural validation happens in extractors.
- **Confidence routing**: `low` confidence extraction → triggers OCR fallback. `medium` → flagged in audit but passes through.
- **Semantic verification**: LLM-as-a-judge runs after deterministic checks for high-stakes skills (compliance, math, doc Q&A, code). Failed verdicts feed into the repair pipeline.
- **Few-shot injection**: Skill-specific golden examples are injected before the current user prompt for format-heavy skills (email, summarization, data_conversion, code, etc.). Zero-shot fallback for skills without examples.
- **OCR model fallback**: When `openai.gpt-oss-120b-1:0` (enhance model) is unavailable, the system transparently falls back to the original routing model without emitting an SSE error.
- **Context-aware skill classification**: `classifyRequestType()` receives a snippet of the uploaded document content alongside the prompt, enabling content-type-based skill detection (code docs → `code`, financial docs → `compliance_pre_assessment`).
- **Dynamic document_qa persona**: The `document_qna` refinement prompt includes 60+ document type → role mappings (code → senior software engineer, pitchbook → investment banking analyst, etc.), selected by the refinement LLM based on document content.
- **Markdown output standardization**: Document extractors output Markdown where possible (DOCX → turndown GFM, CSV/XLSX → Markdown tables, JSON → fenced code block). LLMs perform better with structured Markdown than raw text. Markdown symbols (`|`, `-`, `#`, `` ` ``) do not trigger PII masker patterns.
- **Gotenberg legacy conversion**: Binary Office formats (.doc, .ppt) are converted via Gotenberg's LibreOffice endpoint → PDF → text extraction. Deployed as a separate Cloud Run service with independent scaling. Falls back gracefully if unreachable.
- **Admin dashboard**: Separate `/admin.html` page with 4 tabs — Single User (register/update), Bulk Upload (JSON file with validation/preview/5-concurrent processing/result summary), Usage & Cost (date range, grand total, paginated table), Account Settings (change password). Token shared via `sessionStorage`. Session restored on back navigation.
- **Bulk user upsert**: `POST /api/v1/admin/users/bulk` — accepts array of users, validates schema, processes sequentially (create if missing, update if exists), returns per-item results with `{ username, action, success, error }`.
- **groupName field**: Users have an optional `group_name` column for organizational grouping (e.g. "IT Business Enablement"). Supported in create, update, bulk upload, and cost reporting.
- **Session restore**: `sessionStorage` shares JWT token between `/` and `/admin.html`. On page load, if token exists, it's verified via `GET /api/v1/models` and session is restored without re-login.

- **Dedicated PG connection for locks**: `tryAcquireSessionLock()` uses `pool.connect()` to grab a dedicated client. The lock is acquired AND released on that same client via a returned `release()` closure. Fixes per-connection advisory lock issue where acquire/release could land on different pool connections.
- **Google OAuth JIT provisioning**: `loginWithGoogle()` verifies Google ID token server-side (`google-auth-library`), then JIT-provisions via 3-step process: (1) find by `google_id`, (2) find by email and link, (3) INSERT. Max 3 retries on UNIQUE violation race condition.
- **Sub-agent orchestration trigger guard**: Only triggers when skill IN `[compliance_pre_assessment, requirement_generation, document_qna]` AND complexity >= 4 AND prompt >= 120 chars (unless images present). Minimum 2 specs — single agent falls back to single-shot.
- **Global refinement rules**: `GLOBAL_REFINEMENT_RULES` prepended to all 17 skill prompts at single injection point in `refinePrompt()`. Prevents refinement drift — outputs original prompt verbatim in `task` field, resolves conversational references in `context`.
- **Session preview from assistant message**: Sidebar shows first assistant response (not user message), truncated to 60 chars. Markdown chars (`*`, `#`, `_`) stripped via SQL `REGEXP_REPLACE` before truncation.
- **Sidebar cost synced with stats pill**: Session list query includes `estimated_cost` using actual model pricing from `model_pricing_snapshot` with blended average fallback. Frontend syncs cached cost after each turn and after viewing stats.
- **Auth provider discriminator**: `users.auth_provider` (`'local'` | `'google'`). Google users have `password = NULL`. Local login and changePassword reject Google-linked accounts early.
- **Few-shot contamination guard**: Translation few-shot removed (caused model regurgitation). All other entries use structural `{placeholders}` instead of realistic text to prevent memorization.