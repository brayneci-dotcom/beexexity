# Tech Reference: Beexexity — Unified Inference Gateway

> For code review & evaluation. Covers architecture, tech stack, routing, memory, and all subsystems.

---

## 1. Tech Stack

| Layer | Technology | Version / Notes |
|---|---|---|
| Runtime | Node.js | 24 (Alpine in Docker) |
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
├── server.ts              # HTTP listener entry + EventEmitter.defaultMaxListeners = 50
├── app.ts                 # Express app: middleware, routes, error handler, /health, Cache-Control on HTML
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
│   │                         # + GET/POST /discovered-roles (accept/reject/deploy)
│   ├── models.routes.ts      # GET / (available models with pricing)
│   ├── inference.routes.ts   # POST /generate (JSON + multipart), GET /sessions/active, POST /sessions/reset
│   ├── session.routes.ts     # GET /, GET /:id/messages, GET /:id/stats, POST /:id/resume
│   └── feedback.routes.ts    # POST / (submit), GET/PUT /admin (admin review + synthesis)
├── services/
│   ├── auth.service.ts           # Login, JWT sign/verify, user CRUD, Google OAuth
│   ├── session.service.ts        # Session lifecycle, messages CRUD, stats
│   ├── inference.service.ts      # Bedrock ConverseStream/Converse/InvokeModel, retry, SSE, OCR, repair, semantic judge
│   ├── routing-engine.service.ts # 19-skill classifier + refinement + complexity scoring + policy + verification
│   │                            # + validateSkillInvariants() post-classification guard
│   ├── routing-policy.service.ts # Model selection: manual→long→vision→text
│   ├── sequential-reasoning.service.ts  # Multi-step planner→executor→synthesizer for complex queries
│   │   ├── planner()             # LLM generates 2-6 step plan, returns null for 1 step (fallback)
│   │   ├── executor()            # Sequential step loop with retry, PII per step, audit per step
│   │   ├── synthesizer()         # Always-executes final layer, handles partial/complete/failure
│   │   └── progressiveSynthesis()# Emits interim insight every PROGRESSIVE_INTERVAL steps
│   ├── pii-masker.service.ts     # Indonesian PII detection (NIK, HP, rekening, nama, bank)
│   ├── context-assembly.service.ts    # Sliding window, char budget, routing_payload, summary+facts injection
│   ├── session-memory.service.ts      # Load memory state, summarize evicted, extract facts
│   ├── content-builder.service.ts      # Ordered content blocks for Bedrock Converse
│   ├── document-extractor.service.ts   # PDF, DOCX, PPTX, XLSX, HTML, JSON, CSV, TXT, MD, XML (output: Markdown)
│   ├── image-processor.service.ts      # Image buffer → base64 content block
│   ├── upload-validator.service.ts     # Classify files → documents/images, MIME checks
│   ├── audit.service.ts                # Fire-and-forget audit logs + pricing snapshots + orchestration columns
│   ├── cost-reporting.service.ts       # Per-user cost aggregation
│   ├── few-shot-library.ts             # Per-skill golden examples for format adherence (incl. Indonesian)
│   ├── gotenberg.service.ts            # Legacy Office (.doc, .ppt) → PDF → text via Gotenberg
│   └── file-signature-validator.ts     # Magic byte heuristic gate
├── frontend/
│   ├── cost-display.ts          # IDR rate fetch, session cost tracking
│   └── pricing-config.json      # Per-model pricing (input/output per 1M tokens)
├── types/
│   ├── auth.types.ts
│   ├── session.types.ts         # Session, StoredMessage, BedrockMessage, AssembledContext, SessionStats
│   ├── inference.types.ts       # + SequentialStep, SequentialPlan, StepResult, SequentialOrchestrationMeta
│   ├── routing.types.ts         # 19 skills, routingState: 'auto'|'manual', no isAutoV2
│   ├── pii.types.ts
│   ├── upload.types.ts          # DocumentFile, ImageFile, ExtractionResult, ContentBuildInput, ContentBlock
│   ├── audit.types.ts           # + orchestrationGroupId, orchestrationStepOrder
│   ├── pricing.types.ts
│   ├── reporting.types.ts
│   └── error.types.ts
└── scripts/
    └── run-migrations.ts    # Idempotent migration runner (creates _migrations table)

data/                            # Runtime data (not committed to git)
├── fallback-roles.ndjson         # Raw discovery log for novel fallback roles
└── discovered-roles-state.json   # Accept/reject/deploy state per role

migrations/
├── 001_initial_schema.sql ... 014_feedback_reports.sql  (14 prior migrations)
└── 015_update_skill_taxonomy.sql   # 19-skill constraints, obsolete skill migration

tests/
└── unit/                           # 25 test files, 345 tests
    ├── routing-engine.test.ts      # 12 tests for validateSkillInvariants()
    ├── sequential-reasoning.test.ts # 16 tests (planner, executor, retry, PII, progressive, SSE, audit)
    └── ... (23 other test files)

public/
├── admin.html                      # Admin dashboard — 6 tabs (+ Discovered Roles)
└── index.html                      # SPA frontend — Auto only, no "Thinking" mode
```

---

## 3. Request Lifecycle (Full End-to-End)

### 3.1 Text-only JSON inference

```
Client → POST /api/v1/inference/generate
  Body: { prompt, modelId?, config? }
  modelId: '' (default Auto) or a specific model ID (manual mode)
  
  1. authMiddleware           — JWT validation, attach req.user
  2. forcePasswordResetMiddleware — check flag
  3. inferenceRateLimit       — 20 req/min per IP
  4. Validate prompt          — non-empty, < 64K chars
  5. Validate modelId         — ALLOWED_MODELS or empty (→ auto)
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
  14. Routing engine:
      a. Determine routingState: 'auto' | 'manual'
      b. If 'auto' → routeRequest():
         - unifiedClassifyAndScore()  — single LLM call: skill + complexity + language
         - validateSkillInvariants()  — post-classification deterministic guard (5 rules)
         - refinePrompt()            — skill-aware or follow-up refinement
         - resolvePolicy()           — model selection
         → RoutingDecision
      c. If 'manual' → build RoutingDecision directly, skip routing
  15. Emit SSE events:
      event: session      { sessionId }
      event: routing      { skill, flags, timing, ... }
  16. Unified dispatch:
      complexity >= 4 AND routingState !== 'manual'
      → SequentialReasoner.execute()
         - planner() → 2-6 step plan (returns null → fallback to generate)
         - Emit orchestration_plan SSE
         - executor() + synthesizer() + progressiveSynthesis()
         - Each step passes language system prompt (e.g. "Respond in indonesian")
         - Emit delta + done events
      → else: generate() — Bedrock ConverseStream, SSE delta/metadata/done
  17. verifyOutput()         — deterministic checks against PromptContract
  18. Semantic verification  — semanticJudge() for compliance/logic/code/risk_analyst/data_analysis
      → event: semantic_verdict (if failed)
  19. Auto-repair (if verification fails) → repairResponse() → event: repair
  20. Emit done (sequential reasoning paths only)
  21. Store assistant msg    — PII-masked, increment turnCount
  22. Extract facts          — extractFacts() → update extracted_facts JSONB
  23. Audit log              — metadata-only, fire-and-forget
  24. Memory update          — if messages evicted, summarizeEvicted() → rolling_summary
  25. Release turn lock
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
  5j. effectiveDocText      — ocrText (if available) overrides extraction text
  5k. Unified dispatch: complexity >= 4 → SequentialReasoner, else → generate()
  5l. Fallback: If enhance model fails → auto-fallback to original routing model
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
  routingReasonCode: string;
  reasoningSummary: string;
  modalityFlags: ModalityFlags;
  manualOverrideApplied: boolean;
  flags: string[];                  // e.g. ['skill-demoted:code→fallback', 'refinement-failed']
  skill: SkillType;
  contract: PromptContract | null;
  detectedLanguage?: string;        // e.g. "indonesian", "english"
  routingDurationMs?: number;
  classificationDurationMs?: number;
  refinementDurationMs?: number;
}
```

#### Step-by-step process

```
routeRequest(input)
│
├── [GUARD] routingState === 'manual'?
│     ├── resolvePolicy({ manual: true, manualModelId }) → modelId
│     └── return RoutingDecision (no refinement/scoring)
│
└── routingState === 'auto'?
      │
      ├── 1. UNIFIED CLASSIFY + SCORE  (unifiedClassifyAndScore)
      │     ├── Single qwen3-32b call: returns { skill, complexityScore, language }
      │     ├── Silent upload (files, no prompt) → fallback (no LLM call)
      │     └── Document snippet: first 2000 chars + last 1000 chars (head+tail)
      │
      ├── 2. INVARIANT CHECK  (validateSkillInvariants)  [NEW]
      │     ├── 5 deterministic rules, zero LLM cost
      │     ├── compliance_pre_assessment → requires legal/financial context
      │     ├── risk_analyst             → requires risk/threat context
      │     ├── data_analysis            → requires data/statistical context
      │     ├── code                     → requires ``` or code keywords
      │     ├── process_optimization     → requires process/workflow context
      │     └── → demotes to fallback if rule fails, emits flag
      │
      ├── 3. PROMPT REFINEMENT  (refinePrompt)
      │     ├── Turn 1: SKILL_REFINEMENT_PROMPT (generic template with {{skill}})
      │     ├── Turn 2+: FOLLOW_UP_REFINEMENT_PROMPT (minimal, no role/context)
      │     ├── → PromptContract { role, context, task, intent, ... }
      │     └── Static role from SKILL_TO_ROLE overrides LLM-generated role
      │
      ├── 4. LONG CONTEXT CHECK
      │     └── > 8000 chars prompt+document → override model selection
      │
      ├── 5. POLICY RESOLUTION  (resolvePolicy)
      │     ├── Manual → honor user's selected model
      │     ├── Long context → qwen3-235b
      │     ├── Vision + score 1-3 → GPT-OSS 120B
      │     ├── Vision + score 4-5 → qwen3-235b
      │     └── Text (any score) → qwen3-235b
      │
      └── 6. RETURN RoutingDecision
            └── includes skill, complexity, flags, contract, language
```

### 4.2 The 19 Skills (6 groups)

```
Generation:    business_writing | creative_writing | brainstorming | prompt_optimizer
Transformation: summarization | translation | data_transformation | editing
Interaction:   roleplay | logic_math | planning_strategy
Enterprise:    requirement_generation | compliance_pre_assessment | risk_analyst | process_optimization
Engineering:   code | log_troubleshooting | data_analysis
Fallback:      fallback (catch-all)
```

**Removed:** `document_analysis` — document is a medium, not a cognitive task. Silent uploads route to `fallback` and ask the user what to do. Document-type-specific roles were redistributed to other skill prompts.

**Renamed from original 17:** `email → business_writing`, `creative → creative_writing`, `meta_prompting → prompt_optimizer`, `data_conversion → data_transformation`, `editing_critique → editing`, `general → fallback`

### 4.3 Refinement — Two Modes

| | Turn 1 (no conversationContext) | Turn 2+ (has conversationContext) |
|---|---|---|
| Prompt | `SKILL_REFINEMENT_PROMPT` (generic template with role/context/task/intent) | `FOLLOW_UP_REFINEMENT_PROMPT` (task + intent only, no role/context) |
| LLM input | Original prompt + document context | Original prompt + conversation history |
| Output JSON | Full `PromptContract` including role | Minimal: task + intent + ambiguities |
| Language | Detected language injected via `{{detected_language}}` | Same language detected from input |

**Role override:** LLM-generated role is always replaced with the static role from `SKILL_TO_ROLE`. The LLM-generated role is still logged and, if `skill === 'fallback'` and the role differs from the static one, appended to `data/fallback-roles.ndjson` for the Discovered Roles admin feature.

### 4.4 Routing Policy

```
resolvePolicy(input):
  1. Manual state        → honor user's selected model
  2. Long context        → qwen.qwen3-235b-a22b-2507-v1:0
  3. Vision + score 1-3  → openai.gpt-oss-120b-1:0
  4. Vision + score 4-5  → qwen.qwen3-235b-a22b-2507-v1:0
  5. Text (any score)    → qwen.qwen3-235b-a22b-2507-v1:0
```

**Key invariant**: qwen3-32b is NEVER used for inference — reserved for routing engine tasks (classification, refinement, scoring, progressive synthesis).

### 4.5 Allowed Models

| Model ID | Vision | Context Window | Role |
|---|---|---|---|
| `amazon.nova-lite-v1:0` | Yes | — | OCR extraction via InvokeModel |
| `openai.gpt-oss-120b-1:0` | Yes | 128K | Vision inference (low-mid complexity) |
| `qwen.qwen3-235b-a22b-2507-v1:0` | Yes | 256K | Primary inference + sequential reasoning |
| `qwen.qwen3-32b-v1:0` | Yes | — | Routing engine + progressive synthesis |

---

## 5. Sequential Reasoning (Complex Mode)

### Trigger

```
complexityScore >= 4 AND routingState !== 'manual'
```
Not restricted to specific skills — any request with complexity >= 4 qualifies.

### Architecture

```
SequentialReasoner.execute(input, res)
  ├─ planner()
  │   ├─ Calls qwen3-235b (routed model)
  │   ├─ Structured JSON output: { steps: [{ name, description, systemPrompt }] }
  │   ├─ Constraints: 2 <= steps <= MAX_SEQUENTIAL_STEPS (default 6)
  │   ├─ Map-reduce: if document > LARGE_DOCUMENT_THRESHOLD (50K), force Step 1 = Data Cruncher
  │   ├─ Language preservation: planner prompt tells model to preserve user's language
  │   └─ On failure or <2 steps → returns null (fallback to single-shot)
  │
  ├─ emitPlanSSE()        → event: orchestration_plan
  │
  ├─ executor(plan)
  │   ├─ accumulatedContext initialized with document text (capped at 50K) + conversation history
  │   ├─ For each step:
  │   │   ├─ PII mask step input (fail-closed)
  │   │   ├─ Bedrock ConverseCommand (non-streaming) with language system prompt
  │   │   ├─ Retry up to STEP_RETRY_COUNT (tiered: same prompt → simplified)
  │   │   ├─ Skip step if all retries exhausted, emit orchestration_error
  │   │   ├─ PII mask step output (fail-closed)
  │   │   ├─ Append to accumulated context
  │   │   ├─ Audit per step: fire-and-forget with orchestration_group_id
  │   │   └─ Every PROGRESSIVE_INTERVAL steps → progressiveSynthesis()
  │   └─ → stepResults[]
  │
  ├─ synthesizer()
  │   ├─ ALWAYS runs, even if all steps fail
  │   ├─ Success case: formats accumulated context into cohesive narrative
  │   ├─ Partial case: best-effort response, acknowledges skipped steps
  │   ├─ Failure case: direct response from original prompt
  │   ├─ Uses qwen3-235b (routed model) with language system prompt
  │   └─ → synthesisStatus: 'success' | 'partial' | 'failed'
  │
  ├─ progressiveSynthesis()
  │   ├─ Every PROGRESSIVE_INTERVAL steps (default 3)
  │   ├─ Quick LLM call via qwen3-32b
  │   ├─ → event: orchestration_interim { step, total, insight }
  │
  └─ → SequentialReasoningResult { assistantText, plan, stepResults, synthesisStatus, orchestrationMeta }
```

### SSE Events (Orchestration)

| Event | When | Data |
|---|---|---|
| `orchestration_plan` | After planner | `{ steps: [{ order, name, description }], reasoning }` |
| `orchestration_status` | Per step | `{ step, total, name, description, status: 'running'|'completed'|'failed', durationMs? }` |
| `orchestration_step` | Per step output | `{ step, content }` |
| `orchestration_interim` | Every N steps | `{ step, total, insight }` |
| `orchestration_error` | Step failure | `{ step, name, reason }` |

### Configuration

| Env Var | Default | Description |
|---|---|---|
| `MAX_SEQUENTIAL_STEPS` | 6 | Max steps in plan (2-10) |
| `LARGE_DOCUMENT_THRESHOLD` | 50000 | Char threshold for map-reduce trigger |
| `ORCHESTRATION_TIMEOUT_MS` | 120000 | Max wall-clock for full orchestration |
| `STEP_RETRY_COUNT` | 2 | Max attempts per step |
| `PROGRESSIVE_INTERVAL` | 3 | Emit interim synthesis every N steps |

---

## 6. Session Memory (Three-Tier)

### Tier 1: Raw Recent Turns
- All messages stored in `messages` table per session
- `buildContext()` selects last N messages within char budget (default 120K)
- Default 10 turns max (`maxHistoryTurns`)

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

---

## 7. SSE Events Emitted During Inference

| Event | Timing | Data |
|---|---|---|
| `session` | Start of stream | `{ sessionId }` |
| `routing` | After routing | Full `RoutingMetadataEvent` (skill, flags, complexity, language, timing, raw LLM data) |
| `orchestration_plan` | After planner (complex mode) | `{ steps: [...], reasoning }` |
| `orchestration_status` | Per step progress | `{ step, total, name, status }` |
| `orchestration_step` | Per step output | `{ step, content }` |
| `orchestration_interim` | Every N steps | `{ step, total, insight }` |
| `orchestration_error` | Step failure | `{ step, name, reason }` |
| `delta` | Per token | `{ type: "text", content: "<token>" }` |
| `metadata` | End of stream | `{ inputTokens, outputTokens }` |
| `verification` | After generate | `{ passed, violations, checks }` |
| `semantic_verdict` | After semantic judge | `{ is_correct, missing_elements[] }` |
| `repair` | After verification/judge failure | `{ text: "<repaired content>" }` |
| `session_status` | On storage failure | `{ sessionId, is_degraded: true }` |
| `done` | AFTER verifier+repair | `{}` |
| `error` | On failure | `{ error, message }` |

**Key timing:** `done` is emitted AFTER the verifier + semantic judge + repair block, so repair results arrive before `done`. This fixes the bug where the frontend received `done`, closed the stream, and repair events arrived too late.

---

## 8. Verification & Repair

Two verification layers: deterministic + semantic. Both feed into the same repair pipeline.

### Layer 1: Deterministic (`verifyOutput`)
- Empty output detection
- PII placeholder check disabled intentionally (placeholders in output are correct — masker worked)
- Word count limits from `contract.constraints`
- Required sections from `contract.format.mustInclude` (language-agnostic)
- Forbidden content from `contract.format.mustAvoid`

### Layer 2: Semantic (`semanticJudge`)
- LLM-as-a-judge: calls qwen3-32b (maxTokens=256, temperature=0)
- Runs for high-stakes skills: `compliance_pre_assessment`, `logic_math`, `code`, `risk_analyst`, `data_analysis`
- Returns `{ is_correct: boolean, missing_elements: string[] }`
- Emitted as `event: semantic_verdict` SSE

### Auto-repair (`repairResponse`)
- When either verification layer finds errors, `repairResponse()` calls Bedrock Converse
- Original conversation messages preserved; repair prompt targets only violations
- Repair output → `event: repair` SSE

### Timing
```
generate() or sequentialReasoner → done (emitted by generate path only)
          → verifyOutput() (deterministic)
          → semanticJudge() + repairResponse() ← runs BEFORE done
          → emit done (complex mode only — generate path already emitted it)
          → store, audit, res.end()
```

---

## 9. Document Extraction Pipeline

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

### OCR fallback & Document Text Injection

When extraction returns low-confidence text (image-heavy PDFs, PPTX), the two-stage OCR pipeline extracts the real content. The `effectiveDocText` variable ensures OCR output overrides the empty extraction text for all downstream consumers.

---

## 10. Two-Stage OCR Pipeline

```
needsOCR = images.length > 0 || documentBlocks.length > 0

if needsOCR:
  Stage 1: Nova Lite via InvokeModel (raw API, messages-v1 schema)
           - Processes image blocks + raw document blocks
           - Timeout: 60s, maxTokens: 4096
  
  Stage 2: GPT-OSS 120B enhances OCR output
           - Combines original prompt + OCR text
           - Full streaming response to client
  
  Fallback: If Nova fails or returns empty, GPT-OSS handles natively

  Model fallback: If GPT-OSS fails → fallback to original routing model (qwen3-235b)
```

---

## 11. Gotenberg — Legacy Office Conversion

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
| Env var | `GOTENBERG_URL` (set in Cloud Run) |

---

## 12. PII Masker

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
- Applied per-step in sequential reasoning (input + output, fail-closed per step)

---

## 13. Database Schema

### `users`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| username | VARCHAR(64) | UNIQUE |
| password | VARCHAR(255) | bcrypt hash, nullable for Google users |
| role | VARCHAR(16) | 'admin' | 'user' |
| display_name | VARCHAR(128) | |
| force_password_reset | BOOLEAN | Default true |
| group_name | VARCHAR(255) | Organizational group |
| google_id | VARCHAR(255) | UNIQUE, nullable. Google OIDC sub claim |
| auth_provider | VARCHAR(16) | 'local' | 'google', default 'local' |
| created_at / updated_at | TIMESTAMPTZ | |

### `sessions`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users |
| status | VARCHAR(16) | active | degraded | inactive | expired |
| turn_count | INTEGER | |
| rolling_summary | TEXT | Tier 2 memory |
| memory_version | INTEGER | Default 0 |
| extracted_facts | JSONB | Tier 3 memory |
| expires_at | TIMESTAMPTZ | |
| created_at / updated_at / last_activity_at | TIMESTAMPTZ | |

### `messages`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| session_id | UUID | FK → sessions |
| role | VARCHAR(16) | 'user' | 'assistant' |
| sanitized_content | TEXT | PII-masked |
| storage_flags | JSONB | |
| created_at | TIMESTAMPTZ | |

### `audit_logs`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| timestamp | TIMESTAMPTZ | |
| user_id, username | | Denormalized |
| model_id | VARCHAR(128) | |
| input_tokens, output_tokens | INTEGER | |
| status | VARCHAR(16) | 'success' | 'failed' |
| error_category | VARCHAR(32) | |
| duration_ms | INTEGER | |
| file_count, file_mime_types, total_file_size | | File metadata |
| is_multimodal | BOOLEAN | |
| routing_state, complexity_score, routing_reason_code | | Routing metadata |
| reasoning_summary | TEXT | |
| executed_model_id | VARCHAR(128) | |
| manual_override_applied | BOOLEAN | |
| modality_flags | JSONB | |
| routing_flags | TEXT[] | |
| session_id | UUID | |
| replayed_message_count, context_truncated, context_summarized | | Context stats |
| session_state | VARCHAR(16) | |
| turn_count | INTEGER | |
| model_pricing_snapshot | JSONB | Pricing at request time |
| orchestration_meta | JSONB | Sequential reasoning metadata |
| orchestration_group_id | UUID | Groups per-step audit rows |
| orchestration_step_order | INTEGER | 0 = planner, 1-N = steps |

### `feedback_reports`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| session_id | UUID | |
| user_feedback | TEXT | User's complaint text |
| error_category | VARCHAR(32) | hallucination, missed_context, wrong_tone, formatting_issue, other |
| final_response | TEXT | The LLM output text |
| routing_metadata | JSONB | Enriched: complexity, model, userPrompt, routingContext, flags |
| alignment_summary | TEXT | LLM-generated root cause analysis |
| root_cause_analysis | TEXT | |
| recommendation | TEXT | |
| status | VARCHAR(20) | default 'pending' |
| reviewed_by | VARCHAR(64) | |
| reviewed_at | TIMESTAMPTZ | |
| created_at | TIMESTAMPTZ | |

**Rich feedback:** When user submits feedback, the frontend captures the user prompt and routing context (skill, complexity, flags, verification status) from the status panel. These are stored in `routing_metadata` and fed to the synthesis LLM for root cause analysis.

---

## 14. Configuration (Environment Variables)

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `JWT_SECRET` | — | HS256 secret |
| `JWT_EXPIRES_IN` | 3600 | Token TTL (seconds) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | localhost/5432/bedrock_gateway/postgres/— | PostgreSQL |
| `DB_SSL` | — | Set to 'false' to disable SSL |
| `AWS_REGION` | ap-southeast-3 | Bedrock region |
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `MAX_CONTEXT_CHARACTERS` | 640000 | Character budget for context window |
| `MAX_HISTORY_TURNS` | 20 | Max turns in sliding window |
| `SESSION_EXPIRY_HOURS` | 24 | Session TTL |
| `ROUTING_METADATA_ENABLED` | true | Emit routing SSE event |
| `ROUTING_LONG_CONTEXT_THRESHOLD` | 8000 | Char threshold for long-context override |
| `ROUTING_SCORING_TIMEOUT_MS` | 5000 | Complexity scoring timeout |
| `ROUTING_REFINEMENT_TIMEOUT_MS` | 8000 | Prompt refinement timeout |
| `ROUTING_CLASSIFIER_TIMEOUT_MS` | 2000 | Classifier timeout |
| `ROUTING_DEFAULT_FALLBACK_SCORE` | 2 | Default complexity on scoring failure |
| `MAX_SEQUENTIAL_STEPS` | 6 | Max steps in sequential reasoning plan |
| `LARGE_DOCUMENT_THRESHOLD` | 50000 | Char threshold for map-reduce trigger |
| `ORCHESTRATION_TIMEOUT_MS` | 120000 | Max wall-clock for orchestration |
| `STEP_RETRY_COUNT` | 2 | Max attempts per step before skipping |
| `PROGRESSIVE_INTERVAL` | 3 | Emit interim synthesis every N steps |
| `EXTRACTION_LOW_CONFIDENCE_THRESHOLD` | 100 | Chars below which confidence = 'low' |
| `EXTRACTION_MAX_JSON_DEPTH` | 20 | Max JSON nesting |
| `EXTRACTION_MAX_HTML_DEPTH` | 100 | Max HTML nesting |
| `EXTRACTION_MAX_CSV_ROWS` | 100000 | Max CSV rows |
| `EXTRACTION_MAX_PPTX_ENTRIES` | 2000 | Max PPTX ZIP entries |
| `GOTENBERG_URL` | — | Gotenberg service URL |
| `GOTENBERG_TIMEOUT_MS` | 30000 | Gotenberg conversion timeout |
| `MIN_PASSWORD_LENGTH` | 8 | Minimum password length |

---

## 15. Testing

### Test runner
- Vitest with `globals: true`
- Path alias `@/` → `./src/`

### Test patterns
- **Service tests**: mock database via `vi.mock`, mock Bedrock via `vi.mock('@aws-sdk/client-bedrock-runtime')`
- **Pure function tests**: no mocking needed (context-assembly, content-builder, pii-masker)
- **Route tests**: `vi.mock` for all dependencies

### Test files (25 total, 345 tests)
```
tests/unit/
├── admin.middleware.test.ts
├── app.test.ts
├── audit.service.test.ts
├── auth-google.test.ts
├── auth.middleware.test.ts
├── auth.routes.test.ts
├── auth.service.test.ts
├── content-builder.test.ts
├── context-assembly.service.test.ts
├── cost-calculator.test.ts
├── cost-reporting.routes.test.ts
├── cost-reporting.service.test.ts
├── document-extractor.test.ts
├── file-signature-validator.test.ts
├── image-processor.test.ts
├── inference-retry.test.ts
├── inference.routes.test.ts
├── inference.service.test.ts
├── models.routes.test.ts
├── password-reset.middleware.test.ts
├── pii-detection.test.ts
├── pii-masker-nama.test.ts
├── routing-engine.test.ts       # 12 tests for validateSkillInvariants()
├── sequential-reasoning.test.ts # 16 tests (planner, executor, retry, PII, SSE, audit)
├── session-memory.test.ts
└── session.service.test.ts
```

### Routing Engine Test Coverage
| Test | What it verifies |
|---|---|
| compliance with legal context | Passes through invariant |
| compliance without legal context | Demoted to fallback |
| risk_analyst with risk context | Passes through invariant |
| risk_analyst without risk context | Demoted to fallback |
| data_analysis with data context | Passes through invariant |
| data_analysis without data context | Demoted to fallback |
| code with ``` blocks | Passes through invariant |
| code with function keyword | Passes through invariant |
| code without indicators | Demoted to fallback |
| process_optimization with context | Passes through invariant |
| process_optimization without context | Demoted to fallback |
| non-guarded skills unchanged | business_writing, summarization, fallback pass through |

---

## 16. Important Patterns

- **Unified dispatch**: Single execution path: complexity >= 4 → SequentialReasoner, otherwise → `generate()`. No separate "mode" concept. All queries use the same routing and the same threshold.
- **Post-classification invariant guard**: `validateSkillInvariants()` runs 5 deterministic checks after the LLM classifier. Demotes impossible skill classifications to `fallback`. Zero LLM cost.
- **Head+tail document extraction**: Classifier receives first 2000 + last 1000 chars of document, not just first 800. Better classification signal for long documents.
- **Discovered Roles**: When `skill === 'fallback'` and the refinement model generates a role different from the static "General Purpose Assistant", the role is logged to `data/fallback-roles.ndjson`. The admin dashboard shows a "Discovered Roles" tab with accept/reject/deploy workflow. Accepted roles are candidates for taxonomy expansion.
- **Rich feedback**: Feedback submission includes the user's original prompt + routing context (skill, flags, verification status) alongside the error category and response text. Stored in `feedback_reports.routing_metadata` JSONB.
- **Language-aware sequential reasoning**: Each step and the final synthesis pass `IMPORTANT: Respond in {language}` as a system prompt, derived from the detected language in the routing decision.
- **Conditional format enforcement**: System prompt says "CRITICAL FORMAT INSTRUCTION — you MUST follow this" when `output_format` is present, or "respond in plain text" when absent. No more contradictory anti-markdown rule.
- **Indent-aware markdown rendering**: List items track indentation level via a stack, producing proper nested HTML (`<ul><li>` → `<ul><li>`) instead of flat siblings.
- **Done emission timing**: `event: done` emitted AFTER verifier + semantic judge + repair, so repair results arrive before `done` on the frontend. Fixes silent repair failure.
- **Fail-closed PII**: If masker throws, inference rejected (500). Never sends unmasked data. Applied per-step in sequential reasoning.
- **Graceful degradation**: Routing step failures fall back gracefully. Sequential reasoning falls back to single-shot on planner failure.
- **Distributed turn lock**: PostgreSQL advisory lock prevents concurrent turns. Released in `finally` block.
- **No full content logging**: Audit logs record metadata only.
- **Sanitized errors**: Bedrock errors sanitized — no ARNs, request IDs, or stack traces.
- **Pricing snapshots**: Model pricing captured at inference time for historical accuracy.
- **Language preservation**: `flowingText` construction no longer wraps values in English sentence templates. Refinement outputs values in the user's detected language.
- **Follow-up refinement**: Turn 2+ uses `FOLLOW_UP_REFINEMENT_PROMPT` — skips role/context fields, emits minimal task+intent JSON. Reduces redundant framing.
- **OCR→orchestrator injection**: `effectiveDocText` ensures OCR-extracted content reaches sequential reasoning path.
- **File buffer cleanup**: After multipart inference, file buffers explicitly nullified.
- **Cache-control on HTML**: HTML files served with `Cache-Control: no-cache, no-store, must-revalidate` to prevent stale JS serving.
- **EventEmitter limit**: `EventEmitter.defaultMaxListeners = 50` in `server.ts`.
- **Google OAuth JIT provisioning**: `loginWithGoogle()` verifies Google ID token server-side, then JIT-provisions via 3-step process.
- **Admin dashboard**: Separate `/admin.html` with 6 tabs (user CRUD, bulk upload, cost, settings, model access, feedback reports, discovered roles).
