# Thinking Mode — Extended Reasoning for Supported Models

## Overview

Add **model-level extended thinking** (Claude's `<think>` blocks) to beexexity. This is the Bedrock Converse `thinking` field — the model internally reasons before generating visible tokens — NOT the application-level sequential reasoning (planner→executor→synthesizer) that already exists.

The two are complementary:

| Feature | What it does | When it runs |
|---------|-------------|-------------|
| **Thinking Mode** (NEW) | Model thinks internally before responding. Returns `<think>...</think>` block | Complexity 1-5, any model that supports it |
| **Sequential Reasoning** (existing) | Planner decomposes task, executes steps, synthesizes | Complexity ≥ 4 only |

## Requirements

### R1: Model Detection
The system must know which models support extended thinking and what thinking path they use.

| Path | Models | Wire Format |
|------|--------|-------------|
| `adaptive` | Claude Sonnet 5, Opus 4.8+ | `thinking.type: "adaptive"`, `output_config.effort` |
| `budget_tokens` | Older Claude | `reasoning_config.type: "enabled"`, `budget_tokens: N` |
| `deepseek_string` | DeepSeek | `reasoning_config: "medium"` |
| `none` | All others | No thinking fields |

**Files changed:**
- `src/config/model-capabilities.ts` — add `thinkingPath` to each model entry
- `config/models.toml` (NEW) — externalized config if we want runtime reload (optional)

**Acceptance criteria:**
- WHEN a model supports thinking, the frontend shows a "Thinking" toggle
- WHEN a model doesn't support thinking, the toggle is hidden
- WHEN user enables thinking, the Converse request includes the correct thinking fields

### R2: Backend Inference (ConverseRequest)

Pass the thinking config via `additionalModelRequestFields` to Bedrock Converse.

**Files changed:**
- `src/services/inference.service.ts` — `generate()` function adds `additionalModelRequestFields` with thinking config when thinking is enabled and model supports it

**Wire format for adaptive thinking (Claude):**
```json
{
  "additionalModelRequestFields": {
    "thinking": { "type": "adaptive" },
    "output_config": { "effort": "medium" }
  },
  "inferenceConfig": {
    "maxTokens": 8192,
    "temperature": 1
  }
}
```

**Wire format for budget tokens (older Claude):**
```json
{
  "additionalModelRequestFields": {
    "reasoning_config": {
      "type": "enabled",
      "budget_tokens": 2048
    }
  }
}
```

**Side effects when thinking is enabled:**
- `maxTokens` must be explicitly set (thinking models don't use defaults)
- `topP` must be dropped (thinking rejects it)
- `temperature` is ignored but can stay (thinking models ignore it)

**Acceptance criteria:**
- WHEN thinking is enabled, ConverseStreamCommand includes `additionalModelRequestFields.thinking`
- WHEN thinking is enabled, `maxTokens` is set to at least 4096
- WHEN thinking is enabled, the SSE delta events include `reasoning_content` alongside `content`
- WHEN the model doesn't support thinking and user enables it, return 400 error

### R3: SSE Stream (reasoning_content)

The Bedrock ConverseStream response for thinking models returns a `contentBlockStart` event with a `reasoningContent` block, followed by `contentBlockDelta` events with `reasoningContent` deltas, followed by a `contentBlockStop` event — all BEFORE the text content.

The current SSE handler processes `contentBlockDelta` and assumes it's always text. It needs to handle `reasoningContent` deltas too.

**Files changed:**
- `src/services/inference.service.ts` — stream handler: capture `reasoningContent` deltas separately, emit as `event: reasoning` SSE events

**SSE event flow:**
```
event: reasoning
data: {"type":"text","content":"<thinking_token>"}

event: reasoning
data: {"type":"text","content":"<next_thinking_token>"}

event: delta
data: {"type":"text","content":"<visible_response_token>"}
```

**Acceptance criteria:**
- WHEN the model sends `reasoningContent` blocks, they are emitted as `event: reasoning` SSE
- WHEN no thinking occurs, no `reasoning` events are emitted
- Text `delta` events still work normally (backward compatible)

### R4: Frontend — Thinking Toggle

Add a "Thinking" toggle in the model selector area, active only when the selected model supports thinking.

**Files changed:**
- `public/index.html` — add toggle UI + event handler
- `public/index.html` — pass `thinking: true/false` in the request body (as `config.reasoning_effort`)

**UI:**
```
[Model: qwen.qwen3-235b ▼]  [🧠 Thinking: ON/OFF]  [Send]
```

- Toggle is OFF by default
- Toggle is hidden/disaled when selected model doesn't support thinking
- Toggle state is passed as `config.reasoning_effort: "medium" | null` in the request

**Acceptance criteria:**
- WHEN user selects a thinking-capable model, toggle appears
- WHEN user selects a non-thinking model, toggle is hidden
- WHEN toggle is ON, the request includes `config.reasoning_effort: "medium"`
- WHEN toggle is OFF, no reasoning config is sent

### R5: Frontend — Reasoning Display

Render `<think>...</think>` blocks in the response. The thinking content should be visually distinct from the final answer — shown in a collapsible `<details>` section similar to the status panel.

**Files changed:**
- `public/index.html` — `formatMessage()`: extract `<think>...</think>` blocks, render them in a styled details element
- `public/index.html` — handle `event: reasoning` SSE events: accumulate in a separate buffer, render below the text output

**Visual design (inspired by Claude's web UI):**

```
┌─ 🧠 Thinking ─────────────────┐
│ (collapsible details element)  │
│ The model internal reasoning   │
│ process shown here             │
└────────────────────────────────┘

Final answer text starts here...
```

**CSS for think blocks:**
```css
.assistant-text-content .think-block {
  background: var(--bg-tertiary);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  padding: 0.75rem;
  margin: 0.5rem 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-style: italic;
}
```

**Acceptance criteria:**
- WHEN response contains `<think>...</think>`, it renders in a collapsible block
- WHEN user clicks the thinking toggle, the block expands/collapses
- WHEN no thinking content exists, no block is shown
- WHEN thinking is streamed via `event: reasoning`, it renders incrementally

### R6: Effort Level Selector (Future)

For adaptive thinking models, the effort level (`low`, `medium`, `high`) could be user-selectable. For MVP, hardcode to `medium`.

### R7: Fallback — Sequential Reasoning

When thinking mode is ON but the query complexity is ≥ 4:
- Thinking mode handles the internal reasoning
- Sequential reasoning handles the task decomposition (planner → steps → synthesizer)
- The thinking output is passed through the sequential reasoning pipeline as context

This means both can run simultaneously — thinking for the model, sequential reasoning for the task structure.

---

## Holistic Implications

### Backend

| Area | Impact | Effort |
|------|--------|--------|
| `inference.service.ts` | Add `additionalModelRequestFields` to ConverseStreamCommand. Handle `reasoningContent` deltas in stream loop. | ~50 lines |
| `model-capabilities.ts` | Add `thinkingPath` to each model entry. Export `supportsThinking()`. | ~15 lines |
| `model-capabilities.ts` | Validate thinking compatibility when receiving request. | ~10 lines |
| `inference.routes.ts` | Pass `config.reasoning_effort` from request to inference call. | ~5 lines |
| `audit.types.ts` | Add `reasoningEffort` to audit entry (optional tracking). | ~3 lines |
| Tests | New tests for thinking wire format, stream parsing, effort validation. | ~50 lines |

**Risk areas:**
- Models that don't support thinking but are marked as supporting it → Bedrock returns 400
- Mixing thinking with `topP` or `temperature` → Bedrock silently ignores or errors
- ConverseStream `reasoningContent` block structure varies between models (Claude vs others)

### Frontend

| Area | Impact | Effort |
|------|--------|--------|
| `index.html` | Add Thinking toggle UI in model selector area | ~20 lines |
| `index.html` | Handle `event: reasoning` SSE in stream loop | ~15 lines |
| `index.html` | `formatMessage()`: extract and render `<think>` blocks | ~25 lines |
| `index.html` | CSS for thinking block styling | ~15 lines |

**Risk areas:**
- `<think>` blocks inside markdown might confuse existing renderer
- Streaming thinking content while text is also streaming → interleaving issues
- Mobile responsiveness of the thinking toggle + model selector layout

### Data/DB

No schema changes needed. Thinking mode is a request-time parameter, not stored data.

---

## UX Walkthrough

### Scenario: User enables thinking, asks a complex question

```
┌─ Input Area ──────────────────────────────────────────┐
│ [Model: qwen.qwen3-235b ▼]  [🧠 Thinking: ON]  [Send] │
│ "jelaskan arsitektur sistem pembayaran BI-FAST"       │
└────────────────────────────────────────────────────────┘

┌─ Response ────────────────────────────────────────────┐
│                                                        │
│  ⏳ Initializing...                                     │
│                                                        │
│  ┌─ 🧠 Model Thinking ────────────────────┐             │
│  │  The model is analyzing the BI-FAST     │             │
│  │  architecture, tracing the transaction  │             │
│  │  flow from core banking through        │             │
│  │  integration points...                  │             │
│  └─────────────────────────────────────────┘             │
│                                                        │
│  Arsitektur BI-FAST terdiri dari beberapa komponen     │
│  utama:                                                │
│  1. Core Banking (T24)                                  │
│     - Sistem pencatatan transaksi                      │
│  2. Integration Gateway (iGate)                         │
│     - Routing pesan ISO 20022                           │
│  3. BI-FAST Engine                                      │
│     - Settlement dan kliring real-time                  │
│                                                        │
│  ── ✅ Done (12.3s) ──                                  │
└────────────────────────────────────────────────────────┘
```

### Scenario: User enables thinking, but model doesn't support it

```
┌─ Input Area ──────────────────────────────────────────┐
│ [Model: amazon.nova-lite-v1:0 ▼]  [🧠 Thinking: —]    │
│                                ^disabled/greyed out    │
└────────────────────────────────────────────────────────┘
```

### Scenario: Thinking + Sequential Reasoning (complexity ≥ 4)

```
┌─ step-status ─────────────────────────────────────────┐
│  ⏳ Langkah 2/4: Mengevaluasi kepatuhan...              │
├─ seq-steps ───────────────────────────────────────────┤
│  ✅ 1. ExtractProposal (2.3s)                          │
│  ⏳ 2. EvaluateCompliance                              │
│  ○ 3. FormulateRecommendations                         │
│  ○ 4. SynthesizeResponse                               │
├─ 🧠 Model Thinking ───────────────────────┐            │
│  (each step has its own thinking process)  │            │
└───────────────────────────────────────────┘            │
```

---

## Effort Estimation

| Phase | Files | Lines | Risk |
|-------|-------|-------|------|
| Model capabilities config | 1 | 15 | Low |
| Backend thinking + stream | 3 | 65 | Medium (wire format varies) |
| Frontend toggle + render | 1 | 60 | Low |
| Frontend think-block styling | 1 | 15 | Low |
| **Total** | **6** | **~155** | |
