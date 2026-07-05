Here is the comprehensive, actionable requirement document for **Step 1, Step 2, and Step 3**. This is formatted as a master implementation guide that you can hand directly to a developer (or use yourself) to execute the roadmap in the correct order.

---

# 🚀 Master Implementation Plan: Beexexity v1.3.0

## Step 1: Document Extraction Upgrades (Markdown-First)
**Objective:** Upgrade the document pipeline to output clean Markdown instead of raw text. This instantly makes the LLM 10x smarter when reading user data (especially tables) without adding any infrastructure overhead.
**Scope:** Pure Node.js upgrades. (Skipping Gotenberg/Legacy `.doc`/`.ppt` as decided).

### 1.1 Task Breakdown
- [ ] **TASK-1.1: Install Dependencies**
  - Run `npm install xlsx turndown turndown-plugin-gfm`.
- [ ] **TASK-1.2: Create Markdown Utility**
  - Create `src/utils/markdown-table.ts`.
  - Implement `arrayToMarkdownTable(headers: string[], rows: string[][])` to convert 2D arrays into pipe-delimited Markdown tables.
- [ ] **TASK-1.3: Upgrade XLSX/CSV Extractors**
  - Update `document-extractor.service.ts`.
  - **XLSX:** Use `xlsx` to read the buffer, iterate through sheets, and format as Markdown tables.
  - **CSV:** Use `csv-parse`, then format as a Markdown table. *Constraint: Cap at 500 rows. If > 500, truncate and append `[... truncated X rows]`.*
- [ ] **TASK-1.4: Upgrade DOCX Extractor**
  - Update `extractDocxText()`. 
  - Use `mammoth.convertToHtml()`, then pass the HTML to a `turndown` instance configured with the GFM plugin to output clean Markdown.
- [ ] **TASK-1.5: Update MIME & Frontend**
  - Update `upload.middleware.ts`, `upload-validator.service.ts`, and `public/index.html` to accept `.xls` and `.xlsx`.
- [ ] **TASK-1.6: Write Unit Tests**
  - Create `tests/unit/document-extractor-markdown.test.ts`. Test XLSX, CSV, and DOCX inputs to ensure Markdown output is correctly formatted.

### 1.2 File Impact Matrix
| File | Action |
| :--- | :--- |
| `package.json` | Add `xlsx`, `turndown`, `turndown-plugin-gfm` |
| `src/services/document-extractor.service.ts` | Modify extraction logic for XLSX, CSV, DOCX |
| `src/utils/markdown-table.ts` | **New** Markdown table formatter |
| `src/middleware/upload.middleware.ts` | Add XLS/XLSX MIME types |
| `src/services/upload-validator.service.ts` | Add XLS/XLSX to `DOCUMENT_MIME_TYPES` |
| `public/index.html` | Add `.xls, .xlsx` to file input `accept` attribute |

### 1.3 Definition of Done (DoD)
- [ ] Uploading an Excel file with a financial table results in a perfectly formatted Markdown table in the LLM context.
- [ ] Uploading a CSV > 500 rows triggers the truncation safeguard.
- [ ] Uploading a DOCX preserves headers, bold text, and lists in Markdown format.
- [ ] No changes to the PII masker (Markdown symbols `|`, `-`, `#` do not trigger false positives).

---

## Step 2: Sub-Agent Orchestration
**Objective:** Transform the gateway into an intelligent orchestrator that dynamically spawns specialized sub-agents for complex, multi-step requests.
**Scope:** Implementing the Plan → Execute → Synthesize pipeline.

### ⚠️ Critical Architectural Constraints (From Senior Review)
1. **Trigger Logic:** Do NOT trigger on `complexity > 3` alone. Trigger **ONLY** if `skill` is in `[compliance_pre_assessment, report_generation, complex_document_qna]` **AND** `complexity >= 4`.
2. **Synthesizer Model:** Must use `qwen3-235b` (Tier 3). The 32b model lacks the context window and reasoning power to merge massive sub-agent outputs.
3. **Timeout:** Increase global orchestration timeout to **120 seconds** (Cloud Run allows 300s).
4. **Token Budget:** If combined sub-agent outputs exceed 30,000 tokens, trigger a secondary 32b summarization call *before* synthesis to prevent context overflow.

### 2.1 Task Breakdown
- [ ] **TASK-2.1: Types & Config**
  - Create `src/types/subagent.types.ts` (`SubAgentSpec`, `SubAgentPlan`, `SubAgentResult`).
  - Update `config/index.ts` with `SUBAGENT_CONFIG` (Concurrency: 3, Max Attempts: 2, Timeout: 120s).
- [ ] **TASK-2.2: Update Routing Engine**
  - Modify `routing-engine.service.ts` to output `multiStep: boolean`.
  - Update `resolvePolicy` to enforce the **Skill + Complexity** trigger logic.
- [ ] **TASK-2.3: Implement Sub-Agent Executor**
  - Create `src/services/subagent-executor.service.ts`.
  - Implement `executeAll(specs)`: Resolves dependency graph, runs independent agents in parallel via `Promise.allSettled`, enforces concurrency limit of 3.
  - Streams `subagent_delta` SSE events to the client in real-time.
- [ ] **TASK-2.4: Implement Sub-Agent Synthesizer**
  - Create `src/services/subagent-synthesizer.service.ts`.
  - Aggregates results. Implements the **Token Budget Guardrail** (summarize if > 30k tokens).
  - Calls `InferenceService` using **`qwen3-235b`**.
- [ ] **TASK-2.5: Implement Orchestrator Loop**
  - Create `src/services/subagent-orchestrator.service.ts`.
  - Manages the `plan → execute → synthesize → verify → retry` loop.
  - Handles partial failures (if one agent fails, prompt synthesizer to proceed with available data).
- [ ] **TASK-2.6: Route Integration & SSE**
  - Update `inference.routes.ts`. If `decision.multiStep` is true, bypass standard `generate()` and call `orchestrator.orchestrate()`.
  - Extend `SSEEventType` with `orchestration_plan`, `subagent_delta`, `synthesis_delta`.
- [ ] **TASK-2.7: Prompt Engineering**
  - Create `src/prompts/subagent-planner.prompt.ts` (Strict JSON output for agent specs).
  - Create `src/prompts/subagent-synthesis.prompt.ts` (Handles merging and partial failures).

### 2.2 File Impact Matrix
| File | Action |
| :--- | :--- |
| `src/types/subagent.types.ts` | **New** Sub-agent interfaces |
| `src/config/index.ts` | Add `SUBAGENT_CONFIG` |
| `src/services/subagent-orchestrator.service.ts` | **New** Main orchestration loop |
| `src/services/subagent-executor.service.ts` | **New** Parallel execution & SSE streaming |
| `src/services/subagent-synthesizer.service.ts` | **New** Merging & Token Budget logic |
| `src/prompts/subagent-planner.prompt.ts` | **New** Planner system prompt |
| `src/prompts/subagent-synthesis.prompt.ts` | **New** Synthesis system prompt |
| `src/services/routing-engine.service.ts` | Modify trigger logic (Skill + Complexity) |
| `src/routes/inference.routes.ts` | Add orchestration routing branch |
| `src/services/audit.service.ts` | Add `logOrchestration()` for JSONB metadata |

### 2.3 Definition of Done (DoD)
- [ ] A complex compliance query triggers the orchestrator, spawns 2-3 agents, and returns a unified report.
- [ ] A standard complex query (e.g., `email` skill, complexity 4) does **NOT** trigger the orchestrator (prevents cost explosion).
- [ ] SSE events correctly display the live progress of sub-agents in the frontend.
- [ ] If a sub-agent fails, the synthesis completes using the remaining agents' data.
- [ ] Audit logs successfully capture the `orchestrationMeta` JSONB payload.

---

## Step 3: Semantic Verification (LLM-as-a-Judge)
**Objective:** Add a secondary AI check to catch hallucinations, off-topic responses, and logical errors in high-stakes skills *after* the main generation is complete.
**Scope:** Post-stream verification using a lightweight `qwen3-32b` judge.

### ️ Critical Architectural Constraints
1. **Streaming Timing:** The judge **MUST** run only *after* the main stream is fully consumed and the final `assistantText` is assembled in memory.
2. **Fail-Open:** If the judge LLM crashes or times out, assume `is_correct: true`. Never block the user's response due to a judge failure.
3. **Token Tracking:** The judge's input/output tokens must be captured and added to the `audit_logs` pricing snapshot.

### 3.1 Task Breakdown
- [ ] **TASK-3.1: Implement Semantic Judge**
  - Create `semanticJudge(originalPrompt, assistantText)` in `inference.service.ts`.
  - Calls `qwen3-32b` with a strict prompt: *"Did the assistant accurately and completely fulfill the user's intent? Reply ONLY in JSON: { is_correct: boolean, missing_elements: string[] }"*.
  - Returns `{ is_correct, missing_elements, tokens }`.
- [ ] **TASK-3.2: Define Skill Allowlist**
  - Create `const SEMANTIC_VERIFY_SKILLS = ['compliance_pre_assessment', 'logic_math', 'document_qna', 'code'];`.
- [ ] **TASK-3.3: Integrate into Verification Flow**
  - Update `inference.routes.ts` (both JSON and multipart handlers).
  - Flow: `generate()` → `verifyOutput()` (Deterministic) → **IF passed AND skill in allowlist** → `semanticJudge()`.
  - If judge fails (`is_correct: false`), inject `missing_elements` into the existing `repairResponse()` loop.
- [ ] **TASK-3.4: Update SSE & Auditing**
  - Emit `event: semantic_verdict` with the judge's payload.
  - Update `audit.service.ts` to accept and store the judge's token usage in the pricing snapshot.

### 3.2 File Impact Matrix
| File | Action |
| :--- | :--- |
| `src/services/inference.service.ts` | Add `semanticJudge()` function |
| `src/routes/inference.routes.ts` | Integrate judge into post-stream flow |
| `src/services/audit.service.ts` | Track and store judge token costs |
| `public/index.html` | Add UI handler for `event: semantic_verdict` |

### 3.3 Definition of Done (DoD)
- [ ] Uploading a complex math problem results in the judge verifying the steps. If the LLM hallucinates a number, the judge catches it and triggers a `repair` event.
- [ ] Uploading a standard email draft **skips** the semantic judge (saving tokens).
- [ ] If the Bedrock API for the judge times out, the system gracefully skips the check and returns the original response (Fail-Open).
- [ ] The `audit_logs` table accurately reflects the extra tokens consumed by the judge.

---

### 💡 Execution Advice
1. **Do Step 1 first.** It takes less than an hour and immediately improves the quality of data fed into the system.
2. **Do Step 2 next.** With clean Markdown data from Step 1, your Sub-Agents will actually work correctly when analyzing Excel/CSV files.
3. **Do Step 3 last.** Once the Sub-Agents are generating massive, complex reports, the Semantic Judge is required to ensure those reports didn't hallucinate during the synthesis phase.