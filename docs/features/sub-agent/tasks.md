# Sub-Agent Orchestration — Tasks

**Scope:** Only Step 2 from improvement-DocExtraction.md. Steps 1 & 3 already shipped.

**Traceability:** Each task links to a requirement from `docs/improvement-DocExtraction.md` (Step 2 subsections).

---

## Wave 1: Foundation (Types, Config, Prompts)

- [ ] **[Req 2.1]** Create `src/types/subagent.types.ts`
  - `SubAgentSpec` — fields: `agentId`, `skill`, `prompt`, `targetModel?` (planner chooses cheaper model for simple tasks), `dependencies[]`
  - `SubAgentResult` — fields: `agentId`, `status`, `text` (PII-masked), `errorMessage?` (why failed — passed to synthesizer), `inputTokens`, `outputTokens`, `durationMs`
  - `SubAgentPlan` — fields: `specs[]`, `reasoning`
  - `OrchestrationMeta` — fields: `specs[]`, `results[]`, timing breakdown, `summarizeTriggered`

- [ ] **[Req 2.1]** Add `SUBAGENT_CONFIG` to `src/config/index.ts`
  - `concurrency` (default 3), `maxAttempts` (2), `timeoutMs` (120000), `tokenBudget` (30000)
  - All env-var-configurable

- [ ] **[Req 2.2]** Add `multiStep` to `RoutingDecision` in `src/types/routing.types.ts`
  - `multiStep?: boolean` — false by default

- [ ] **[Req 2.6]** Add 3 SSE event types to `src/types/inference.types.ts`
  - `OrchestrationPlanEvent: { specs: SubAgentSpec[], reasoning: string }`
  - `SubAgentDeltaEvent: { agentId: string, status: string, text?: string }`
  - `SynthesisDeltaEvent: { type: "text", content: string }` (reuse existing delta format)
  - Add to `RoutingMetadataEvent`? No — new types, not extending it.

- [ ] **[Req 2.7]** Create `src/prompts/subagent-planner.prompt.ts`
  - System prompt instructing LLM to output a JSON array of SubAgentSpec
  - "Break this task into 2-4 parallel sub-agents, OR return empty array if the task is simple enough for single-shot"
  - **Opt-out contract:** empty `specs[]` = "this task doesn't need orchestration" — orchestrator falls back to single-shot
  - Can specify `targetModel` per agent if the sub-task is simple (e.g. data extraction → qwen3-32b)
  - Strict JSON output format
  - Uses qwen3-32b

- [ ] **[Req 2.7]** Create `src/prompts/subagent-synthesis.prompt.ts`
  - System prompt for merging sub-agent outputs into a cohesive response
  - "You are a synthesis agent. Below are outputs from specialized sub-agents..."
  - Handle partial failures: "If an agent failed, note it and proceed with available data"

## Wave 2: Routing Trigger

- [ ] **[Req 2.2]** Update `src/services/routing-engine.service.ts`
  - After `resolvePolicy`, check if `skill` in `[compliance_pre_assessment, requirement_generation, document_qna]` AND `complexity >= 4`
  - If yes, set `decision.multiStep = true`
  - Add trigger reason to `decision.flags` (e.g. `'multi-step-triggered'`)

## Wave 3: Core Services

- [ ] **[Req 2.3]** Create `src/services/subagent-executor.service.ts`
  - `executeAll(specs: SubAgentSpec[], res: Response): Promise<SubAgentResult[]>`
  - Runs agents in parallel with concurrency limit (custom semaphore or simple batch-chunk)
  - Each agent calls existing `generate()` from inference.service with sub-agent prompt
  - Streams `subagent_delta` SSE events per agent:
    - `status=running` — `text` contains incremental token stream (frontend buffers per agent)
    - `status=done` — final
    - `status=failed` — includes `errorMessage`
  - **PII masking:** Apply `mask()` to each sub-agent's output before storing in `SubAgentResult.text`
  - Captures tokens & duration per agent
  - Timeout handling: AbortController with SUBAGENT_CONFIG.timeoutMs

- [ ] **[Req 2.4]** Create `src/services/subagent-synthesizer.service.ts`
  - `synthesize(specs: SubAgentSpec[], results: SubAgentResult[], res: Response): Promise<{text: string, tokens: {input, output}}>`
  - **Per-agent token budget:** Check each agent's output individually against `tokenBudget / agentCount`. If any single agent exceeds its share, run qwen3-32b summarization on THAT agent's output only. Never summarize the combined blob — avoids "lost in the middle."
  - Calls qwen3-235b with synthesis prompt + agent results (including `errorMessage` for failed agents)
  - Streams `synthesis_delta` SSE events (reuses existing delta-style streaming)
  - **Structured fallback:** If synthesis LLM fails, do NOT raw-concatenate. Wrap in: `# Partial Results\n\n_Some responses could not be merged._\n\n## Agent: {name}\n{output}`

- [ ] **[Req 2.5]** Create `src/services/subagent-orchestrator.service.ts`
  - `orchestrate(routingInput, contextOutput, res, user): Promise<{assistantText, orchestrationMeta}>`
  - Sequentially: plan → [opt-out gate?] → injectContext → execute → synthesize
  - Calls planner (qwen3-32b via Converse), parses JSON specs
  - **Opt-out gate:** If `specs` is empty (planner decided orchestration unnecessary) OR planner failed → immediately fall back to single-shot generation (call `generate()` directly). No error — transparent degradation.
  - **Context injection:** After planner returns non-empty specs, inject document text + conversation history wrapped in strict XML tags:
    - `<document_context>\n{maskedDocumentText}\n</document_context>` (if docs present)
    - `<conversation_context>\n{conversationContext}\n</conversation_context>` (last 2 turns)
    - Planner output is BASE instruction only; orchestrator enriches it with XML-delimited reference material
    - Keeps intent and reference separate — prevents hallucination from blended instructions
  - Passes enriched specs to executor → results to synthesizer (including `errorMessage` from failed agents)
  - Collects orchestrationMeta for audit

## Wave 4: Route Integration & Audit

- [ ] **[Req 2.6]** Update `src/routes/inference.routes.ts`
  - In both `handleJsonInference` and `handleMultipartInference`:
  - After routing decision, check `decision.multiStep`
  - If true, call `orchestrator.orchestrate()` instead of standard `generate()`
  - Pass through existing PII masking, session validation, turn locking, message storage
  - Reuse existing verifier + semanticJudge after synthesis

- [ ] **[Req 2.6]** Update `src/services/audit.service.ts`
  - Add `orchestrationMeta?: OrchestrationMeta` to audit log payload
  - If orchestrator ran, include meta in the audit log call

## Wave 5: Tests

- [ ] Write `tests/unit/subagent-orchestrator.test.ts`
  - Planner JSON parsing — valid/invalid/missing/empty-array (opt-out path)
  - Planner opt-out → falls back to single-shot generation, no orchestrationMeta
  - Token budget calculation — trigger summarization at threshold
  - Partial failure handling — 1/3 agents fail with `errorMessage`, verify synthesis prompt includes it
  - Trigger logic — correct skill+complexity combos fire, others don't
  - **PII masking verification** — sub-agent output containing NIK/phone/bank account is masked before reaching `SubAgentResult.text`

---

## Checkpoints

- [ ] **Checkpoint — `npm run build` passes** (after Wave 1)
- [ ] **Checkpoint — `npm test` passes** (after Wave 5)
- [ ] **Checkpoint — Manual verify:** A complex compliance query with complexity >= 4 triggers orchestrator, spawns 2-3 agents, returns unified response
- [ ] **Checkpoint — Manual verify:** Standard email query (complexity < 4) does NOT trigger orchestrator
- [ ] **Checkpoint — Manual verify:** SSE events flow in correct order: orchestration_plan → subagent_delta × N → synthesis_delta → done
- [ ] **Checkpoint — Manual verify:** If planner fails or returns empty specs (opts out), falls back to standard single-shot generation gracefully — no crash, no empty execution
- [ ] **Checkpoint — Manual verify:** Context injection uses `<document_context>` XML tags — verify via logging that injected prompt has clean structure
- [ ] **Checkpoint — Manual verify:** Audit log contains orchestrationMeta when orchestrator runs
- [ ] **Checkpoint — Manual verify:** Sub-agent outputs are PII-masked (inject test doc with NIK, verify `[NIK_1]` in synthesized output not raw number)
