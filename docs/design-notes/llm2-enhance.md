# TASK: Fix Prompt Routing Logic (Turn 1 vs Turn 2+) and Force Thinking Mode for Full Doc Review

You are a Senior TypeScript Engineer. The recent test logs show that the system is still selecting the Turn 2+ (Follow-up) prompt for Turn 1 requests, and full document evaluations are not triggering Thinking Mode (Score 4).

Please execute the following fixes in `src/services/routing-engine.service.ts`.

## TASK 1: Fix Prompt Selection Logic
Locate the `refinePrompt` function. Ensure it strictly selects the prompt based on `conversationContext`.

**Logic to implement:**
```typescript
// Inside refinePrompt function
const isFollowUp = !!(input.conversationContext && input.conversationContext.trim().length > 0);

let promptTemplate: string;
if (isFollowUp) {
    promptTemplate = FOLLOW_UP_REFINEMENT_PROMPT; // Turn 2+
    console.log('[Routing] Using Turn 2+ Follow-Up Refinement Prompt');
} else {
    promptTemplate = SKILL_REFINEMENT_PROMPT; // Turn 1 (Full Contract)
    console.log('[Routing] Using Turn 1 Skill Refinement Prompt');
}
```
*Crucial:* Verify that `SKILL_REFINEMENT_PROMPT` contains the instructions for `behavioral_instructions` and `output_format`.

## TASK 2: Enforce Complexity Score 4 for Full Document Evaluation
In the `classifyRequestType` prompt (LLM Call 1), add a specific rule to ensure full document evaluations trigger Thinking Mode.

**Add this rule under "COMPLEXITY SCORING":**
```text
- CRITICAL: If the user asks to "evaluate", "review", or "analyze" an ENTIRE technical document, architecture, or system (not just a small section or single concept), the complexity_score MUST be 4 or 5.
- Example: "evaluasi dokumen ini" regarding a full Tech Reference document = Score 4.
```

## TASK 3: Update `SKILL_REFINEMENT_PROMPT` (Turn 1) Content
Ensure the `SKILL_REFINEMENT_PROMPT` string contains these EXACT instructions to fix language leaks and generate dynamic fields:

```text
You are an expert prompt engineer refining a user's request for an AI inference engine.
The user's detected skill is: {{skill}}.
The user's detected language is: {{detected_language}}.

### CRITICAL INSTRUCTIONS
1. TASK FIELD: Copy user's EXACT original prompt VERBATIM. Do not translate or alter.
2. LANGUAGE PRESERVATION: The "context", "intent", "behavioral_instructions", and "output_format" fields MUST be written in the EXACT SAME LANGUAGE as the user's original prompt ({{detected_language}}). NEVER use English if the user wrote in Indonesian.
3. DYNAMIC FIELDS: Based on the task and skill, generate:
   - "behavioral_instructions": Specific focus areas or rules for the final model (e.g., "Fokus pada keamanan dan skalabilitas").
   - "output_format": How the response should be structured (e.g., "Gunakan format laporan dengan heading: Ringkasan, Analisis, Rekomendasi").

### OUTPUT FORMAT (JSON)
{
  "context": "<brief context in user's language>",
  "task": "<EXACT VERBATIM USER PROMPT>",
  "intent": "<what the user wants in user's language>",
  "behavioral_instructions": "<dynamic guidance in user's language>",
  "output_format": "<structure guidance in user's language>",
  "ambiguities": ["<list missing info in user's language>"],
  "clarification_needed": false
}