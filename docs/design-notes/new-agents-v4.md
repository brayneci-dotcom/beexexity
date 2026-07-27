# `beexexity` — Official Requirement Proposal v4.0 (The Surgical Edition)

**Date:** July 13, 2026  
**Version:** 4.0 (Final Approved)  
**Status:** Ready for Execution  
**Guiding Principle:** The 7-Step Execution Ladder & Anti-BS Rules (YAGNI, Deletion over Addition, No Placeholders)

---

## 1. Executive Summary

This proposal executes a **surgical, high-ROI refactor** of the `beexexity` inference gateway. It completely discards the over-engineered v3.0 architecture (which would have added ~2,800 lines of code, destroyed streaming latency, and introduced dangerous auto-approving AI loops). 

Instead, v4.0 adopts the **"100-Line Alternative"**, resulting in a **net deletion of ~1,400 lines of code**. It achieves the actual business goals—fixing routing hallucinations, supporting the new 19-skill taxonomy, and enforcing strict verification—by leveraging existing battle-tested mechanisms (`unifiedClassifyAndScore`, `PromptContract`, `sequentialReasoner`) and deleting dead legacy code.

---

## 2. Core Philosophy (The Anti-BS Mandate)

Every line of code in this proposal must survive the following checks:
1. **YAGNI:** Do we actually need this, or is it a "nice to have"?
2. **Already Exists:** Does the codebase or standard library already do this?
3. **Deletion over Addition:** Can we solve this by deleting dead code instead of writing new code?
4. **No Placeholders:** If we build it, it must be fully implemented, not a `// TODO` stub.

---

## 3. Updated Skill Taxonomy (19 Skills)

We are moving from 17 skills to **19 skills**. Crucially, we are **removing `document_qna` / `document_analysis`**. A document is a *medium* (data carrier), not a *cognitive task*. The skill must always be tied to the explicit prompt or the actual context of the document content.

| Group | Skills | Count |
| :--- | :--- | :--- |
| **Generation** | `business_writing`, `creative_writing`, `brainstorming`, `prompt_optimizer` | 4 |
| **Transformation** | `summarization`, `translation`, `data_transformation`, `editing` | 4 |
| **Interaction** | `roleplay`, `logic_math`, `planning_strategy` | 3 |
| **Enterprise** | `requirement_generation`, `compliance_pre_assessment`, `risk_analyst`, `process_optimization` | 4 |
| **Engineering** | `code`, `log_troubleshooting`, `data_analysis` | 3 |
| **Fallback** | `fallback` (renamed from `general`) | 1 |
| **Total** | | **19** |

**Behavioral Change for Silent Uploads:**
If a user uploads a file with *no explicit prompt*, the system will no longer hardcode a fake document skill. It will route to `fallback` and explicitly ask the user: *"You uploaded [filename]. What would you like me to do with this document?"*

---

## 4. Execution Plan (Phased Rollout)

### Phase 1: The Great Deletion (Highest ROI)
*Goal: Remove dead code and legacy paths to simplify the codebase before adding anything new.*

1. **Delete Legacy Parallel Sub-Agents (~1,500 lines removed):**
   - Delete `src/services/subagent-orchestrator.service.ts`
   - Delete `src/services/subagent-executor.service.ts`
   - Delete `src/services/subagent-synthesizer.service.ts`
   - Delete `src/prompts/subagent-planner.prompt.ts` and `subagent-synthesis.prompt.ts`
   - Remove their imports and the `orchestrate()` branch in `inference.routes.ts`.
2. **Delete Dead Routing Functions:**
   - Remove `classifyRequestType()` and `scoreComplexity()` from `routing-engine.service.ts` (they were replaced by `unifiedClassifyAndScore()`).
3. **Fix Stale Code & Comments:**
   - Remove the duplicate `GET /sessions/active` route handler in `inference.routes.ts`.
   - Update comments in `skill-role-map.ts` and `routing.types.ts` to reflect **19 skills**, not 17.

### Phase 2: Surgical Routing Invariants (~35 Lines)
*Goal: Eliminate the 2-5% skill hallucination rate without adding LLM latency or replacing the router.*

Add a `validateSkillInvariants()` post-validation guardrail in `routing-engine.service.ts`. This runs *after* `unifiedClassifyAndScore()` returns a skill. It enforces hard business rules by checking the combined context of the prompt + document text.

```typescript
function validateSkillInvariants(skill: SkillType, input: RoutingInput): SkillType {
  // Combine prompt and document text for holistic context checking
  const fullContext = `${input.originalPrompt} ${input.maskedDocumentText || ''}`.toLowerCase();

  // Rule 1: Compliance requires legal/financial/regulatory context
  if (skill === 'compliance_pre_assessment') {
    const hasLegalContext = /legal|financial|regulatory|compliance|kepatuhan|peraturan/.test(fullContext);
    if (!hasLegalContext) return 'fallback';
  }

  // Rule 2: Risk Analyst requires risk/threat context
  if (skill === 'risk_analyst') {
    const hasRiskContext = /risk|threat|vulnerability|risiko/.test(fullContext);
    if (!hasRiskContext) return 'fallback';
  }

  // Rule 3: Data Analysis requires structured data/statistical context
  if (skill === 'data_analysis') {
    const hasDataContext = /data|statistical|trend|analisis/.test(fullContext) || 
                           input.maskedDocumentText?.includes(','); // CSV heuristic
    if (!hasDataContext) return 'fallback';
  }

  // Rule 4: Code requires actual code indicators
  if (skill === 'code') {
    const hasCodeBlocks = input.originalPrompt.includes('```');
    const hasCodeKeywords = /\b(function|class|var|let|const|def|import|public|private)\b/.test(input.originalPrompt.toLowerCase());
    if (!hasCodeBlocks && !hasCodeKeywords) return 'fallback';
  }

  return skill; // All checks passed
}
```

### Phase 3: Unify Dispatch (~50 Lines)
*Goal: Simplify the execution branching in `inference.routes.ts`.*

Update Step 17 in `inference.routes.ts` to remove the legacy `multiStep` flag logic. Implement clean dispatch:

```typescript
if (routingDecision.complexityScore >= 3 && routingDecision.routingState !== 'manual') {
  // Use the battle-tested sequential reasoner (Thinking mode)
  result = await SequentialReasoner.execute(input, res);
} else {
  // Fast path: Stream directly to user
  result = await generate(input, res);
}
```

### Phase 4: Language-Agnostic Verification (~10 Lines)
*Goal: Enforce quality for the 3 new skills without breaking Indonesian language support.*

1. **Update Skill Refinement Prompts (`SKILL_PROMPTS`):**
   Instead of hardcoding English strings in `verifyOutput()`, update the refinement prompts for `risk_analyst`, `process_optimization`, and `data_analysis` to dynamically populate `contract.format.mustInclude` **in the user's detected language**.
   
   ```typescript
   // Example for risk_analyst
   generateMustInclude: (language: string) => {
     return language === 'indonesian' 
       ? ['Identifikasi risiko', 'Penilaian kemungkinan', 'Strategi mitigasi']
       : ['Risk identification', 'Likelihood assessment', 'Mitigation strategies'];
   }
   ```
   *The existing `verifyOutput()` already checks `contract.format.mustInclude` automatically.*

2. **Update `semanticJudge` Trigger List:**
   In `inference.service.ts`, add `'risk_analyst'` and `'data_analysis'` to the `SEMANTIC_VERIFY_SKILLS` array. (1-line change).

### Phase 5: Localization & Test Coverage
*Goal: Complete the 19-skill taxonomy and ensure the router is tested.*

1. **Add Indonesian Few-Shots:**
   Update `few-shot-library.ts` to include Indonesian examples for `risk_analyst`, `process_optimization`, and `data_analysis`.
2. **Write `routing-engine.test.ts`:**
   Create the missing test file. Write tests specifically for the new `validateSkillInvariants()` function to ensure impossible skills correctly fall back to `fallback`.

### Phase 6: Database Constraint Migration
*Goal: Update DB constraints to reflect the new 19-skill taxonomy.*

Create a single migration: `015_update_skill_taxonomy.sql`.
- Update `CHECK` constraints on `audit_logs` and `feedback_reports` to allow the new 19 skills.
- Data migration: Update existing rows where `routing_skill = 'general'` to `'fallback'`, and `routing_skill = 'document_qna'` to `'fallback'` (or map to the actual skill if metadata allows).

---

## 5. What We Explicitly Rejected (and Why)

To ensure absolute clarity on scope, the following v3.0 proposals are **officially rejected**:

| Rejected Component | Reason for Rejection (Ladder Check) |
| :--- | :--- |
| **BedrockProvider Abstraction** | **YAGNI.** Codebase uses ONLY Bedrock. The existing `bedrockClient` export already solves the shared client problem. |
| **Intent-First Router (2-step LLM)** | **Already Exists.** `unifiedClassifyAndScore()` is highly optimized. Replacing it with LLM + keyword matching destroys latency and introduces fragile substring bugs. Post-validation invariants solve the 2-5% hallucination rate in 35 lines. |
| **Unified ReAct Agent Graph** | **Already Exists / UX Regression.** `sequentialReasoner` is battle-tested and streams tokens. A generic ReAct loop would kill streaming for 80% of simple queries. Deleting the legacy parallel sub-agents is the correct simplification. |
| **Auto Self-Improvement Job** | **YAGNI / Dangerous.** The existing `feedback_reports` + `synthesizeReport()` already provides LLM-assisted root cause analysis for human review. Building an auto-approving AI loop creates an echo chamber with no rollback mechanism. |
| **Hardcoded Verification Rules** | **Language Violation.** Hardcoding `output.includes('Likelihood')` breaks Indonesian support. Using `PromptContract.format.mustInclude` is language-agnostic and already built. |
| **4 New DB Tables** | **YAGNI.** They only existed to serve the rejected ReAct Graph and Auto-Improvement systems. |

---

## 6. Success Metrics & ROI

| Metric | v3.0 Proposal (Over-engineered) | v4.0 Surgical Plan (Approved) |
| :--- | :--- | :--- |
| **Net Lines of Code** | +1,300 lines | **-1,400 lines** |
| **New DB Tables** | 3 new tables | **0** |
| **New LLM Calls per Request**| +1 (Intent extraction) | **0** |
| **Streaming UX for Simple Queries**| Ruined (blocked by ReAct loop) | **Preserved** (fast path intact) |
| **Language Support** | Broken (hardcoded English checks) | **Preserved** (uses `mustInclude`) |
| **Self-Improvement** | Dangerous auto-approving AI loop | **Safe** (existing human-in-the-loop) |
| **Time to Ship** | 10-11 Weeks | **1-2 Weeks** |

### Final Verdict
By adopting the **v4.0 Surgical Plan**, we achieve the actual goals (fixing routing hallucinations, cleaning up legacy code, supporting the 19-skill taxonomy) while **deleting** 1,400 lines of dead weight and preserving the excellent streaming UX and language preservation that already exist in the codebase. 
