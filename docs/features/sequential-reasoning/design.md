# Design: Sequential Reasoning Engine v2

## Architecture

### Mode Flow: auto_v2

User selects "Auto v2" in model dropdown → frontend sends `selectedModel: "auto_v2"`.

```
Request { modelId: "auto_v2" }
  → inference.routes.ts
    → validateModelId("auto_v2")     ← accepts "auto_v2" as valid pseudo-model
    → routingState = 'auto'           ← same routing logic as Auto
    → routeRequest(routingInput with isAutoV2: true)
      → classify, refine, score as normal
      → RoutingDecision { isAutoV2: true, complexityScore: N }
    → check: isAutoV2 && complexityScore >= 4?
      → YES: SequentialReasoner.execute()
      → NO:  standard generate()     ← zero overhead when complexity < 4
```

Single `if` branch after routing metadata SSE. No duplicate code paths.

### Request Flow (auto_v2 Sequential Path)

```
1. Routing Engine (classify → refine → score)  ← standard, unchanged
2. SSE: routing metadata                         ← standard, unchanged
3. Trigger check: isAutoV2 && complexity >= 4
4. SequentialReasoner.execute():
   a. Planner: LLM call → execution plan (2-6 steps)
   b. SSE: orchestration_plan { steps, reasoning }
   c. For each step:
      - PII mask step input
      - Bedrock ConverseStream (step prompt + accumulated context)
      - SSE: orchestration_status     ← status=running
      - SSE: orchestration_step       ← streaming tokens
      - On failure: retry(STEP_RETRY_COUNT) → skip if exhausted
      - SSE: orchestration_status     ← status=completed|failed
      - PII mask step output, append to accumulated context
      - Audit: fire-and-forget per step
      - Every PROGRESSIVE_INTERVAL: SSE orchestration_interim
   d. Synthesizer (always runs, even if all steps skipped):
      - Takes accumulated context + step results
      - Formats final cohesive response
      - Resolves contradictions flagged by steps
      - Acknowledges any skipped steps
   e. SSE: standard delta events (synthesizer output streamed)
5. Store assistant message, audit parent, memory update (unchanged)
```

### Integration Points

| File | Change |
|---|---|
| `src/types/inference.types.ts` | Add `auto_v2` routing state. SSE event types. `SequentialPlan`, `SequentialStep`, `StepResult`, `SequentialOrchestrationMeta` |
| `src/types/routing.types.ts` | Add `isAutoV2?: boolean` to `RoutingInput` and `RoutingDecision` |
| `src/config/index.ts` | Add env vars: `MAX_SEQUENTIAL_STEPS`, `LARGE_DOCUMENT_THRESHOLD`, `ORCHESTRATION_TIMEOUT_MS`, `STEP_RETRY_COUNT`, `PROGRESSIVE_INTERVAL` |
| `src/services/inference.service.ts` | `validateModelId("auto_v2")` returns `"auto_v2"`. Export `generateNonStreaming()` for step calls |
| `src/services/routing-engine.service.ts` | Pass `isAutoV2` through `RoutingDecision` |
| `src/services/routing-policy.service.ts` | `resolvePolicy()`: `auto_v2` routingState → same policy as `auto` |
| `src/services/sequential-reasoning.service.ts` | **NEW.** Planner → Executor → Synthsizer. Entry: `execute()` |
| `src/routes/inference.routes.ts` | Single `if` after routing, before `generate()`. Handle `isAutoV2` + complexity gate |
| `src/services/audit.service.ts` | Accept `orchestrationGroupId`, `orchestrationStepOrder` for per-step audit |
| `src/services/session-memory.service.ts` | Inject orchestration context on multi-turn |
| Frontend | Add "Auto v2" to dropdown. Handle 5 new SSE event types |

---

## Components

### SequentialReasoner (`src/services/sequential-reasoning.service.ts`)

```typescript
class SequentialReasoner {
  constructor(private config: SequentialReasoningConfig) {}

  async execute(input: SequentialReasoningInput, res: Response): Promise<SequentialReasoningResult>
}

interface SequentialReasoningInput {
  originalPrompt: string;            // PII-masked
  refinedPrompt: string;             // Post-routing refined prompt
  maskedDocumentText?: string;       // For map-reduce check
  conversationHistory: BedrockMessage[];
  userId: string;
  sessionId: string;
  routingDecision: RoutingDecision;
  inferenceConfig?: InferenceConfig;
}

interface SequentialReasoningResult {
  assistantText: string;
  plan: SequentialPlan;
  stepResults: StepResult[];
  synthesisStatus: 'success' | 'partial' | 'failed';
  orchestrationMeta: SequentialOrchestrationMeta;
}
```

Internal breakdown:

```
execute()
  ├─ planner()            → plan: SequentialPlan | null
  ├─ emitPlanSSE()        → SSE: orchestration_plan
  ├─ executor(plan)       → stepResults: StepResult[]
  │   └─ for each step:
  │       ├─ runStep()
  │       │   ├─ maskStepInput()
  │       │   ├─ bedrockCall()     ← ConverseStream with retry
  │       │   ├─ maskStepOutput()
  │       │   └─ auditStep()
  │       ├─ emitStepSSE()
  │       └─ if step % PROGRESSIVE_INTERVAL == 0:
  │           └─ progressiveSynthesis() → SSE: orchestration_interim
  ├─ synthesizer()        → finalAssistantText  ← ALWAYS runs
  │   ├─ incorporate stepResults (including skipped steps)
  │   ├─ resolve contradictions
  │   └─ acknowledge gaps
  └─ buildMeta()          → SequentialOrchestrationMeta
```

### Planner

- **Model:** qwen3-235b (routed model, not qwen3-32b)
- **System prompt:** Generate step plan for user request
- **Structured output via JSON schema:**
  ```json
  { "steps": [
    { "name": "Data Analysis",
      "description": "Analyze extracted data for patterns",
      "systemPrompt": "You are a data analyst. ..." }
  ], "reasoning": "Chosen because..." }
  ```
- **Constraints:** 2 <= steps.length <= config.maxSequentialSteps
- **Map-reduce override:** If `maskedDocumentText.length > config.largeDocumentThreshold`, enforce Step 1 as Data Cruncher (condense to ~2K chars)
- **On failure:** return null → caller falls back to single-shot

### Executor

```
for each step in plan.steps:
  attempt = 0
  success = false
  while attempt < config.stepRetryCount:
    attempt++
    stepInput = mask(accumulatedContext + stepPrompt)
    try:
      res.write(`event: orchestration_status\ndata: ${statusRunning(step)}`)
      response = await bedrock.converseStream({ model, messages, system })
      result = streamAndEmit(response, res)   // → orchestration_step SSE
      maskedResult = mask(result.text)
      accumulatedContext += maskedResult
      res.write(`event: orchestration_status\ndata: ${statusCompleted(step, result)}`)
      success = true
      auditStep(step, result, orchestrationGroupId)
      break
    catch:
      if attempt < config.stepRetryCount:
        if attempt == 1: continue (same prompt)
        if attempt == 2: stepPrompt = simplifyPrompt(stepPrompt)
      else:
        res.write(`event: orchestration_error\ndata: ${errorPayload(step)}`)
        res.write(`event: orchestration_status\ndata: ${statusFailed(step)}`)

  // Progressive synthesis check
  if step.order % config.progressiveInterval == 0 && accumulatedContext.length > 0:
    interim = await quickSynthesis(accumulatedContext, step)
    res.write(`event: orchestration_interim\ndata: ${interimPayload(interim)}`)
```

### Synthesizer (Separate Always-Execute Layer)

**Key difference from original doc:** Synthesizer is NOT the last step in the plan. It's a separate layer that ALWAYS executes, even if no steps completed successfully.

- **Input:** `accumulatedContext` (whatever was collected), `stepResults` (including failures/skips)
- **Behavior:**
  - If all steps success: formats accumulated context into cohesive narrative
  - If some steps skipped: produces best-effort response, notes gaps
  - If all steps failed: generates direct response from original prompt (fallback to single-shot quality)
  - Resolves contradictions flagged via `<contradiction>` tags in step output
  - Acknowledges skipped steps: "Note: Step 2 (regulatory check) couldn't complete"
- **Model:** qwen3-235b (same as routed model)
- **Output:** SSE `delta` events (same format as standard `generate()`)

### Progressive Synthesis

- **Trigger:** After every `PROGRESSIVE_INTERVAL` steps (e.g., after 3, 6)
- **Action:** Quick LLM call (`qwen3-32b`, cheap) summarizing findings so far
- **Output:** SSE `orchestration_interim` event with partial insights
- **Frontend:** Renders interim insights in sidebar or between step indicators
- **Synthesizer:** Takes progressive outputs as context, avoids re-summarizing

---

## Database Migration

### Migration 012: Orchestration Audit Columns

```sql
-- 012_orchestration_audit.sql
-- Adds grouping columns for per-step orchestration audit rows.

ALTER TABLE audit_logs
  ADD COLUMN orchestration_group_id UUID;

ALTER TABLE audit_logs
  ADD COLUMN orchestration_step_order INTEGER;

COMMENT ON COLUMN audit_logs.orchestration_group_id IS
  'Groups child audit rows from one sequential reasoning execution. Parent row also gets this UUID.';

COMMENT ON COLUMN audit_logs.orchestration_step_order IS
  '0 = planner call, 1-N = execution steps. NULL for non-orchestrated requests.';

-- Index for grouping queries (cost reporting, debugging)
CREATE INDEX idx_audit_logs_orch_group ON audit_logs(orchestration_group_id)
  WHERE orchestration_group_id IS NOT NULL;
```

No other DB changes needed. `audit_logs.orchestration_meta` JSONB column (migration 010) already exists for parent-level metadata.

---

## Configuration & Environment Variables

### New config fields (`src/config/index.ts`)

```typescript
config: {
  // ... existing ...
  orchestration: {
    maxSequentialSteps: parseInt(env.MAX_SEQUENTIAL_STEPS || '6', 10),    // 2-10
    largeDocumentThreshold: parseInt(env.LARGE_DOCUMENT_THRESHOLD || '50000', 10),
    orchestrationTimeoutMs: parseInt(env.ORCHESTRATION_TIMEOUT_MS || '120000', 10),
    stepRetryCount: parseInt(env.STEP_RETRY_COUNT || '2', 10),
    progressiveInterval: parseInt(env.PROGRESSIVE_INTERVAL || '3', 10),
  },
}
```

### Full env var table

| Variable | Default | Min | Max | Description |
|---|---|---|---|---|
| `MAX_SEQUENTIAL_STEPS` | 6 | 2 | 10 | Max steps in plan |
| `LARGE_DOCUMENT_THRESHOLD` | 50000 | 1000 | - | Char threshold for map-reduce |
| `ORCHESTRATION_TIMEOUT_MS` | 120000 | 30000 | 300000 | Max wall-clock for orchestration |
| `STEP_RETRY_COUNT` | 2 | 1 | 5 | Max attempts per step |
| `PROGRESSIVE_INTERVAL` | 3 | 2 | 6 | Emit interim synthesis every N steps |

---

## Data Models

### New Types (`src/types/inference.types.ts`)

```typescript
// Extended routing state
type RoutingState = 'auto' | 'auto_v2' | 'manual';

interface SequentialStep {
  order: number;          // 1-indexed
  name: string;
  description: string;
  systemPrompt: string;   // Full prompt for Bedrock
  modelId: string;
}

interface SequentialPlan {
  steps: SequentialStep[];
  reasoning: string;
}

interface StepResult {
  order: number;
  status: 'success' | 'failed' | 'skipped';
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  retryCount: number;
  errorMessage?: string;
}

interface SequentialOrchestrationMeta {
  plan: { steps: { name: string; description: string }[] };
  stepResults: StepResult[];
  synthesisStatus: 'success' | 'partial' | 'failed';
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
}

// SSE event payloads
interface OrchestrationPlanEvent {
  steps: { order: number; name: string; description: string }[];
  reasoning: string;
}

interface OrchestrationStatusEvent {
  step: number;
  total: number;
  name: string;
  description: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
}

interface OrchestrationStepEvent {
  step: number;
  content: string;        // Streaming token fragment
}

interface OrchestrationInterimEvent {
  step: number;
  total: number;
  insight: string;        // Partial synthesis of findings so far
}

interface OrchestrationErrorEvent {
  step: number;
  name: string;
  reason: string;
}
```

### Modified Types (`src/types/routing.types.ts`)

```typescript
interface RoutingInput {
  // ... existing ...
  isAutoV2?: boolean;
}

interface RoutingDecision {
  // ... existing ...
  isAutoV2?: boolean;
  // multiStep? — REPLACED by isAutoV2 + complexity gate
}
```

---

## SSE Event Schema

```
event: orchestration_plan
data: {"steps":[{"order":1,"name":"Data Extraction","description":"Extract key info from document"},{"order":2,"name":"Analysis","description":"Analyze patterns"}],"reasoning":"Document is complex, requires extraction then analysis"}

event: orchestration_status
data: {"step":2,"total":4,"name":"Cross-reference Check","description":"Cross-referencing extracted data against BI regulations","status":"running"}

event: orchestration_status
data: {"step":2,"total":4,"name":"Cross-reference Check","description":"Cross-referencing extracted data against BI regulations","status":"completed","durationMs":5432}

event: orchestration_step
data: {"step":2,"content":"token fragment..."}

event: orchestration_interim
data: {"step":3,"total":6,"insight":"So far we have identified 3 key clauses in the document..."}

event: orchestration_error
data: {"step":2,"name":"Cross-reference Check","reason":"Bedrock timeout after 2 retries"}
```

---

## Frontend: SSE Handling

### Progress UI

```
┌─────────────────────────────────────┐
│ Auto v2 - Sequential Reasoning      │
│ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐    │
│ │ 1✓│→│ 2✓│→│ 3⠇│→│ 4 │→│ 5 │    │
│ └───┘ └───┘ └───┘ └───┘ └───┘    │
│ Running: Cross-reference Check...  │
│                                     │
│ ── Interim Insight ──               │
│ Found 3 key clauses in document...  │
│ ──────────────────────              │
└─────────────────────────────────────┘
```

- `orchestration_plan` → build step indicator list
- `orchestration_status` → animate step indicator: spinner→check→cross
- `orchestration_step` → optional: expandable per-step output panel (collapsed by default)
- `orchestration_interim` → render insight card between step indicators
- `orchestration_error` → turn step indicator red, show tooltip with reason
- On `done` event → collapse progress panel, show final response

### Page Refresh Mid-Orchestration

- SSE connection terminates on refresh → server stops execution (no orphan calls)
- No server-side mid-stream persistence
- Session retains messages up to last fully completed turn
- On reconnect: frontend detects "previous turn was interrupted" via `reasoning_mode` flag on session
- Shows banner: "Previous Auto v2 analysis was interrupted. Send your prompt again to retry."
- **Future:** persist completed steps to `sessions.rolling_summary` for recovery

### Partial Results on Error

- If some steps completed before failure, Synthesizer includes them
- Frontend renders final response normally (with "partial result" indicator if synthesisStatus === 'partial')
- User still gets valuable output even when chain breaks

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Planner LLM fails | Fall back to single-shot `generate()`. Log warning. No SSE emitted. |
| Planner returns 1 step | Fall back to single-shot. |
| Step fails (all retries exhausted) | Skip step, emit `orchestration_error`, continue chain. Synthesizer notes gap. |
| PII masking fails on step input | Fail the step, trigger retry. If persists, skip. |
| PII masking fails on step output | Fail closed — reject output, trigger retry. If persists, skip. |
| Synthesizer fails | Emit accumulated context as raw response. |
| User disconnects mid-execution | Server stops. Partial state lost (v2: persist to rolling_summary). |
| All steps skipped | Synthesizer runs on original prompt only. Emits best-effort response. |
| Total time > ORCHESTRATION_TIMEOUT_MS | Abort remaining steps. Synthesizer with partial results. |

---

## Changes to Existing Files

### inference.types.ts
- Add `'auto_v2'` to `RoutingState`
- Add `SequentialStep`, `SequentialPlan`, `StepResult`, `SequentialOrchestrationMeta`
- Add `OrchestrationPlanEvent`, `OrchestrationStatusEvent`, `OrchestrationStepEvent`, `OrchestrationInterimEvent`, `OrchestrationErrorEvent`

### routing.types.ts
- Add `isAutoV2?: boolean` to `RoutingInput` and `RoutingDecision`

### config/index.ts
- Add `orchestration` config block with 5 new env vars

### inference.service.ts
- `validateModelId("auto_v2")` → `"auto_v2"`
- Export `generateNonStreaming()` for step calls

### routing-policy.service.ts
- `resolvePolicy()`: `routingState === 'auto_v2'` → same as `'auto'`

### inference.routes.ts
After routing SSE emitted, before `generate()`:

```typescript
if (routingDecision?.isAutoV2 && (routingDecision.complexityScore ?? 0) >= 4) {
  const seqResult = await sequentialReasoner.execute({...}, res);
  result = {
    assistantText: seqResult.assistantText,
    inputTokens: seqResult.orchestrationMeta.totalInputTokens,
    outputTokens: seqResult.orchestrationMeta.totalOutputTokens,
    modelId: executedModelId,
    status: 'success',
  };
  orchestrationMeta = seqResult.orchestrationMeta;
} else {
  result = await generate(conversationRequest, res);
}
```

### audit.service.ts
- Add `orchestrationGroupId?: string` and `orchestrationStepOrder?: number` to `AuditLogEntry`

### Frontend
- Add `auto_v2` to model dropdown
- Handle 5 SSE event types:
  - `orchestration_plan` → build step indicators
  - `orchestration_status` → animate step state
  - `orchestration_step` → expandable per-step panel
  - `orchestration_interim` → render insight card
  - `orchestration_error` → show step failure
- On refresh: show "interrupted" banner, offer retry
- On partial result: show "partial" badge on final response
