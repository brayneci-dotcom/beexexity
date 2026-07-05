# Sub-Agent Orchestration — Design

## Overview

Transform the gateway into an intelligent orchestrator that dynamically spawns specialized sub-agents for complex, multi-step requests. Instead of a single LLM call, the system plans sub-tasks, executes them concurrently, and synthesizes results into a unified response.

**Trigger:** Only for `compliance_pre_assessment`, `requirement_generation`, `document_qna` skills with complexity >= 4.

## Architecture

```
routeRequest() → decision.multiStep=true
    ↓
Orchestrator.plan(prompt, skill, context)
    → LLM planner (qwen3-32b) outputs JSON spec list
    → each spec: { agentId, prompt, targetModel?, dependencies[] }
    ↓
┌─ specs empty? ───────────────┐
│ YES → fall back to single-shot│
│        generation, skip       │
│        orchestration          │
└───────────────────────────────┘
    ↓ (specs non-empty)
Orchestrator.injectContext(specs, documents, history)
    → Wrap document text + conversation history in XML tags:
        <document_context>
        {masked document text}
        </document_context>
        <conversation_context>
        {last 2 user turns}
        </conversation_context>
    → Planner output is BASE instruction; orchestrator enriches it with
      strict XML-separated context sections
    → Ensures sub-agents see full content without losing focus
    ↓
Orchestrator.execute(specs)
    → Promise.allSettled (concurrency 3)
    → each agent calls Bedrock ConverseStream (targetModel || qwen3-235b)
    → SSE events: subagent_delta per agent (real-time, streaming tokens)
    → PII-mask each agent's output before storing in SubAgentResult
    ↓
Orchestrator.synthesize(results)
    → Per-agent token check: if ANY agent's output > (tokenBudget / agentCount),
      run qwen3-32b summarization on THAT agent's output only
    → qwen3-235b merges results → final response
    → SSE events: synthesis_delta (streamed)
    ↓
verifyOutput() + semanticJudge() (existing)
    ↓
audit with orchestrationMeta JSONB
```

## Key Decisions (Lazy/YAGNI)

- **No dependency graph:** All sub-agents run in parallel. Synthesizer handles partial failures. DAG adds complexity without demonstrated need.
- **Reuse existing `generate()`:** Sub-agent execution and synthesis both call the existing `generate()` function with custom system prompts. No new Bedrock invocation code.
- **Reuse existing SSE infrastructure:** Add 3 new event types, reuse existing streaming and error handling.
- **Reuse existing audit:** Add `orchestrationMeta` JSONB to existing audit log call. No new table.
- **Planner uses qwen3-32b** (cheap, fast). Execution & synthesis use qwen3-235b (powerful, accurate).
- **Planner can opt out:** If planner determines the task doesn't need sub-agents, it returns an empty specs array. Orchestrator falls back to single-shot generation — no crash, no empty execution.
- **Context injection by orchestrator, not planner:** Planner outputs only the BASE instruction. Orchestrator injects document text + conversation history wrapped in strict XML tags (`<document_context>`, `<conversation_context>`) to keep intent and reference material separate. Prevents hallucination from blended instructions.
- **Sub-agent model selection:** Planner can specify `targetModel` per agent (defaults to qwen3-235b). Lets planner choose cheaper models (qwen3-32b, gpt-oss-120b) for simple extraction tasks.
- **PII masking on sub-agent outputs:** Executor masks each sub-agent's output before storing in `SubAgentResult.text`. Prevents raw PII from reaching synthesizer context.
- **Structured synthesizer fallback:** If synthesis LLM fails, do NOT raw-concatenate. Wrap in a clear markdown message explaining partial results.

- **Per-agent summarization:** Token budget check is per-agent, not combined blob. If one agent outputs 25k tokens, only that agent's output gets summarized by qwen3-32b. Keeps summarizer context small and avoids "lost in the middle."

## Components & Interfaces

### New Files

| File | Purpose |
|------|---------|
| `src/types/subagent.types.ts` | SubAgentSpec, SubAgentResult, SubAgentPlan, OrchestrationMeta |
| `src/services/subagent-orchestrator.service.ts` | Main orchestrator: plan → execute → synthesize |
| `src/services/subagent-executor.service.ts` | Parallel execution with concurrency & SSE streaming |
| `src/services/subagent-synthesizer.service.ts` | Merge results, token budget guard, stream final response |
| `src/prompts/subagent-planner.prompt.ts` | System prompt for LLM planner (JSON output) |
| `src/prompts/subagent-synthesis.prompt.ts` | System prompt for synthesis LLM |

### Modified Files

| File | Change |
|------|--------|
| `src/types/routing.types.ts` | Add `multiStep` to RoutingDecision |
| `src/types/inference.types.ts` | Add SubAgentDeltaEvent, OrchestrationPlanEvent, SynthesisDeltaEvent |
| `src/config/index.ts` | Add SUBAGENT section (concurrency, timeout, maxAttempts) |
| `src/services/routing-engine.service.ts` | Add skill+complexity trigger logic, set multiStep flag |
| `src/routes/inference.routes.ts` | Branch to orchestrator when multiStep=true |
| `src/services/audit.service.ts` | Accept & store orchestrationMeta |
| `src/services/inference.service.ts` | Export `generate()` for sub-agent & synthesis use |

### Key Interfaces

```typescript
// subagent.types.ts
interface SubAgentSpec {
  agentId: string;
  skill: string;           // sub-skill focus for this agent
  prompt: string;          // base instruction (orchestrator injects doc context after planner)
  targetModel?: string;    // optional: 235b default, planner can pick 32b or 120b for simple tasks
  dependencies: string[];  // reserved for future DAG
}

interface SubAgentResult {
  agentId: string;
  status: 'success' | 'failed' | 'timeout';
  text: string;            // PII-masked by executor before returning
  errorMessage?: string;   // why it failed — passed to synthesizer prompt
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

interface SubAgentPlan {
  specs: SubAgentSpec[];
  reasoning: string;
}

interface OrchestrationMeta {
  specs: SubAgentSpec[];
  results: SubAgentResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
  plannerDurationMs: number;
  executeDurationMs: number;
  synthesisDurationMs: number;
  synthesizeUsed: boolean;
  summarizeTriggered: boolean;
}
```

### SSE Events

| Event | Payload | When |
|-------|---------|------|
| `orchestration_plan` | `{ specs: SubAgentSpec[], reasoning: string }` | After planner runs |
| `subagent_delta` | `{ agentId: string, status: 'running'\|'done'\|'failed', text?: string }` | Per agent. When `status=running`, `text` contains **incremental token stream** (like main delta), not accumulated full text. Frontend keeps per-agent buffer. |
| `synthesis_delta` | `{ type: "text", content: string }` | During synthesis stream (reuses existing delta format) |

## Configuration

```typescript
// config/index.ts additions
subagent: {
  concurrency: parseInt(process.env.SUBAGENT_CONCURRENCY || '3', 10),
  maxAttempts: parseInt(process.env.SUBAGENT_MAX_ATTEMPTS || '2', 10),
  timeoutMs: parseInt(process.env.SUBAGENT_TIMEOUT_MS || '120000', 10),
  tokenBudget: parseInt(process.env.SUBAGENT_TOKEN_BUDGET || '30000', 10),
}
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Planner LLM fails | Fall back to single-shot generation (no orchestration) |
| Planner returns empty specs (opts out) | Treat same as plan-fail: fall back to single-shot generation |
| Individual sub-agent fails | Proceed with remaining agents; mark failed with `errorMessage` |
| All sub-agents fail | Emit error event, fall back to single-shot generation |
| Synthesizer LLM fails | Wrap concatenated outputs in a structured markdown message: `# Partial Results\n\n_Some responses could not be merged. Here are the individual agent outputs:_\n\n## Agent: {name}\n{output}` — never dump raw concatenated text |
| Single agent exceeds token budget | Run per-agent qwen3-32b summarization on that agent's output only |
| Timeout (120s) | Abort pending agents, synthesize partial results |

## Testing Strategy

- Unit test: planner prompt parsing, token budget calculation, partial failure handling
- Integration test: mock Bedrock calls, verify orchestrator loop with fake agent outputs
- Verify SSE events emitted in correct order: plan → subagent_delta × N → synthesis_delta → done
- Verify trigger logic: only fires for correct skill+complexity combos
- Verify PII masking: sub-agent outputs containing NIK/phone/bank numbers are masked before reaching `SubAgentResult.text` (assert `generate()` used `mask()` on output)
