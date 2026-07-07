# Tasks: Sequential Reasoning Engine v2

---

## Wave 1: DB Migration

- [ ] **1.1** Create `migrations/012_orchestration_audit.sql` — add `orchestration_group_id UUID`, `orchestration_step_order INTEGER` to `audit_logs`, with index [Req 8]
- [ ] **1.2** Run migration: `npx tsx src/scripts/run-migrations.ts`

## Wave 2: Configuration & Types

- [ ] **2.1** Add orchestration env vars to `src/config/index.ts` — `MAX_SEQUENTIAL_STEPS`, `LARGE_DOCUMENT_THRESHOLD`, `ORCHESTRATION_TIMEOUT_MS`, `STEP_RETRY_COUNT`, `PROGRESSIVE_INTERVAL` [Req Config]
- [ ] **2.2** Add `'auto_v2'` to `RoutingState` in `src/types/routing.types.ts` [Req 1]
- [ ] **2.3** Add `isAutoV2?: boolean` to `RoutingInput` and `RoutingDecision` in `src/types/routing.types.ts` [Req 2]
- [ ] **2.4** Add `SequentialStep`, `SequentialPlan`, `StepResult`, `SequentialOrchestrationMeta` to `src/types/inference.types.ts` [Req 3, Req 4]
- [ ] **2.5** Add SSE event types: `OrchestrationPlanEvent`, `OrchestrationStatusEvent`, `OrchestrationStepEvent`, `OrchestrationInterimEvent`, `OrchestrationErrorEvent` [Req 10]
- [ ] **2.6** Update `validateModelId()` in `src/services/inference.service.ts` to accept `"auto_v2"` [Req 1]
- [ ] **2.7** Update `resolvePolicy()` in `src/services/routing-policy.service.ts` — `routingState === 'auto_v2'` → same as `'auto'` [Req 1]
- [ ] **2.8** Update `routeRequest()` to pass `isAutoV2` through `RoutingDecision` [Req 2]

## Wave 3: Sequential Reasoning Service

- [ ] **3.1** Create `src/services/sequential-reasoning.service.ts` — `SequentialReasoner` class with `execute()` entry [Req 3, Req 4]
- [ ] **3.2** Implement `planner()` — structured qwen3-235b call, JSON schema, 2-6 steps, null fallback [Req 3]
- [ ] **3.3** Map-reduce override in planner — text > `LARGE_DOCUMENT_THRESHOLD` → force Step 1 = Data Cruncher [Req 6]
- [ ] **3.4** Implement `executor()` + `runStep()` — sequential loop: PII mask → Bedrock → accumulate [Req 4]
- [ ] **3.5** Step retry — `STEP_RETRY_COUNT` attempts, tiered (same prompt → simplified) [Req 5]
- [ ] **3.6** Step-level PII masking — input + output, fail-closed [Req 7]
- [ ] **3.7** Step-level audit — fire-and-forget with `orchestrationGroupId` [Req 8]
- [ ] **3.8** Implement `synthesizer()` as separate always-execute layer — handles success/partial/failure [Req 4]
- [ ] **3.9** Progressive synthesis — every `PROGRESSIVE_INTERVAL` steps, emit `orchestration_interim` [Req 11]

## Wave 4: Integration

- [ ] **4.1** Add `auto_v2` branch in `handleJsonInference()` — after routing SSE, before `generate()` [Req 2]
- [ ] **4.2** Add `auto_v2` branch in `handleMultipartInference()` [Req 2]
- [ ] **4.3** Fallback to single-shot when complexity < 4 or planner returns null [Req 2, Req 3]
- [ ] **4.4** Add `orchestrationGroupId` and `orchestrationStepOrder` to `AuditLogEntry` in `audit.service.ts` [Req 8]
- [ ] **4.5** Remove/replace existing `multiStep` + subagent-orchestrator branch [Cleanup]

## Wave 5: Frontend

- [ ] **5.1** Add "Auto v2" to model dropdown [Req 1]
- [ ] **5.2** Handle `orchestration_plan` → step indicator list [Req 10]
- [ ] **5.3** Handle `orchestration_status` → animate steps (spinner → check/cross) [Req 10]
- [ ] **5.4** Handle `orchestration_step` → expandable per-step panel [Req 10]
- [ ] **5.5** Handle `orchestration_interim` → insight card [Req 11]
- [ ] **5.6** Handle `orchestration_error` → red indicator with tooltip [Req 10]
- [ ] **5.7** On refresh mid-orchestration: detect interrupted turn, show retry banner [Req 12]
- [ ] **5.8** On partial result: "partial" badge on final response [Req 12]

## Wave 6: Multi-Turn

- [ ] **6.1** Inject `<orchestration_context>` block in follow-up prompts when previous turn used sequential [Req 9]
- [ ] **6.2** Update `extractFacts()` to capture step findings/verdicts [Req 9]
- [ ] **6.3** Cap orchestration context block in sliding window (max 10K chars) [Req 9]

## Wave 7: Testing

- [ ] **7.1** Unit: `planner()` — valid plan, 1-step fallback, LLM failure, map-reduce override [Req 3, Req 6]
- [ ] **7.2** Unit: `runStep()` — success, retry 2x, skip exhausted, simplified prompt retry [Req 5]
- [ ] **7.3** Unit: PII masking per step — input, output, fail-closed [Req 7]
- [ ] **7.4** Unit: `synthesizer()` — all success, partial, all failed [Req 4]
- [ ] **7.5** Unit: progressive synthesis fires at correct intervals [Req 11]
- [ ] **7.6** Integration: auto_v2 + complexity >= 4 → full sequential flow → SSE events [Req 10]
- [ ] **7.7** Integration: auto_v2 + complexity < 4 → single-shot fallback [Req 2]
- [ ] **7.8** Integration: audit per-step records with correct `orchestrationGroupId` [Req 8]
- [ ] **7.9** **Checkpoint:** `npm test` passes

## Wave 8: Cleanup & Ship

- [ ] **8.1** Remove deprecated subagent-orchestrator service if fully replaced
- [ ] **8.2** `npm run build` — clean compile
- [ ] **8.3** `npm run lint` — no new warnings
- [ ] **8.4** Manual smoke test on dev: auto_v2 with complex request, verify SSE events in browser console
