# Feature: Sequential Reasoning Engine v2

## Overview
Transform Beexexity from single-turn LLM proxy into sequential reasoning engine. For complex requests, dynamically generate step-by-step Chain-of-Thought execution plan. Steps execute sequentially, each building on previous context. Delivered as `auto_v2` mode — opt-in dropdown option alongside models, default `auto`.

## Glossary
- **Planner:** LLM call analyzing user request → N execution steps (2-6)
- **Executor:** Loop running each step sequentially, accumulating context
- **Synthesizer:** Separate final layer — always executes, formats accumulated context into cohesive response, even if prior steps skipped
- **Progressive Synthesis:** Every 3 steps, emit intermediate synthesis to frontend for livelier UX
- **Map-Reduce:** Step 1 condenses large documents (>50K chars) before analysis steps
- **auto_v2:** New mode in model-select dropdown enabling sequential reasoning

## Requirements

### [Req 1] Mode Selection
- **WHEN** user opens model dropdown
- **THEN** "Auto v2" appears as selectable option alongside "Auto" and model names
- **AND** default remains "Auto"
- **AND** selection sticky per session (like current model selection)

### [Req 2] Trigger Condition
- **WHEN** user selects "Auto v2" AND submits request
- **THEN** routing engine runs classification, refinement, complexity scoring as normal
- **THEN** sequential reasoning triggers ONLY IF: `mode === 'auto_v2'` AND `complexity_score >= 4`
- **AND** complexity < 4 → standard single-shot (zero overhead)
- **AND** NOT restricted to specific skills — any complexity >= 4 qualifies

### [Req 3] Planner
- **WHEN** sequential reasoning triggers
- **THEN** Planner LLM (qwen3-235b) generates step plan with 2-6 steps
- **AND** each step has: name, description, system prompt
- **AND** Planner returns 1 step or fails → fall back to single-shot
- **AND** document text > `LARGE_DOCUMENT_THRESHOLD` → Step 1 auto-assigned as Data Cruncher (condense to ~2K chars)

### [Req 4] Sequential Execution
- **WHEN** plan is ready
- **THEN** steps execute strictly sequentially (Step 1 → Step N)
- **AND** each step receives accumulated context from all prior steps
- **AND** before each step, emit SSE `orchestration_status`
- **AND** each step emits SSE `orchestration_step` with streaming tokens
- **AND** Synthesizer runs AFTER all steps (even if some skipped) — formats accumulated context into final cohesive response

### [Req 5] Retry & Resilience
- **WHEN** step fails (LLM error)
- **THEN** retry 1: same prompt + model
- **AND** retry 2: simplified prompt (strip complex formatting)
- **AND** `STEP_RETRY_COUNT` env var controls max attempts
- **AND** all retries exhausted → skip step with `orchestration_error` SSE, continue chain
- **AND** Synthesizer notes which steps were skipped in final output

### [Req 6] Map-Reduce for Large Documents
- **WHEN** masked document text > `LARGE_DOCUMENT_THRESHOLD` (default 50K chars)
- **THEN** Planner must assign Step 1 as Data Cruncher
- **AND** Data Cruncher output is condensed summary (~2K chars)
- **AND** Steps 2+ inject condensed summary instead of raw text

### [Req 7] PII Safety (Per-Step)
- **WHEN** each step executes
- **THEN** PII masker applied to step input BEFORE Bedrock call
- **AND** PII masker applied to step output BEFORE passing to next step
- **AND** fail-closed: masking error → fail the step

### [Req 8] Audit Per-Step
- **WHEN** each step completes (including planner)
- **THEN** fire-and-forget `logInference()` call per step
- **AND** all child rows share `orchestration_group_id` UUID for grouping
- **AND** `orchestration_meta` JSON written to parent audit row

### [Req 9] Multi-Turn Continuity
- **WHEN** user sends follow-up after sequential reasoning turn
- **THEN** context assembler injects hidden `<orchestration_context>` block into prompt
- **AND** `rolling_summary` and `extracted_facts` capture step findings, risks, verdicts

### [Req 10] SSE Events
- **WHEN** sequential reasoning executes
- **THEN** emit these events:
  - `orchestration_plan`: step list + descriptions + reasoning
  - `orchestration_status`: current step progress with status (`running|completed|failed`)
  - `orchestration_step`: streaming per-step tokens
  - `orchestration_interim`: progressive synthesis (every 3 steps) — partial insights
  - `orchestration_error`: step failure with reason

### [Req 11] Progressive Synthesis
- **WHEN** executor completes 3rd, 6th, etc. step (every `PROGRESSIVE_INTERVAL`)
- **THEN** emit SSE `orchestration_interim` with intermediate synthesis of findings so far
- **AND** frontend shows partial insights while remaining steps execute
- **AND** Synthesizer at end incorporates all progressive outputs, avoids duplication

### [Req 12] Frontend Resilience
- **WHEN** user refreshes page mid-orchestration
- **THEN** active orchestration is lost (no server-side persistence mid-stream)
- **AND** session retains messages up to the last fully completed turn
- **AND** UI shows "Previous analysis was interrupted. You can retry with Auto v2."
- **AND** in future iteration: save partial plan to `session.rolling_summary` for recovery

## Env Configuration

| Variable | Default | Description |
|---|---|---|
| `MAX_SEQUENTIAL_STEPS` | 6 | Max steps in plan (2-10 allowed) |
| `LARGE_DOCUMENT_THRESHOLD` | 50000 | Char threshold for map-reduce trigger |
| `ORCHESTRATION_TIMEOUT_MS` | 120000 | Max wall-clock for full orchestration |
| `STEP_RETRY_COUNT` | 2 | Max attempts per step |
| `PROGRESSIVE_INTERVAL` | 3 | Emit interim synthesis every N steps |

## Non-Goals
- No parallel execution
- No external tool calling
- No human-in-the-loop
- No server-side mid-execution persistence (v2 concern)
