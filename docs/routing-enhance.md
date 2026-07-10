# Requirement Detail: Routing Engine Quality Improvement

## 1. Background & Context

**Project**: Beexexity — Unified Inference Gateway  
**Module**: `src/services/routing-engine.service.ts`  
**Related Files**: 
- `src/services/inference.service.ts`
- `src/services/routing-policy.service.ts`
- `src/types/routing.types.ts`
- `src/config/index.ts`

**Current State**: Routing engine menggunakan `qwen3-32b` untuk 2 LLM calls (classify + refine). Terdapat beberapa masalah kualitas:
1. Prompt classifier tidak memiliki panduan complexity score yang lengkap (terpotong di Score 1)
2. LLM Call 2 gagal mempertahankan instruksi "VERBATIM" untuk field `task`
3. Role selection dihalusinasi oleh LLM (contoh: "senior software engineer" untuk dokumen BRD)
4. Tidak ada JSON Schema enforcement, menyebabkan parsing risk
5. Tidak ada pemisahan eksplisit antara Turn 1 dan Turn 2+ refinement logic

---

## 2. Problem Statement

| # | Problem | Impact | Severity |
|---|---------|--------|----------|
| P1 | Complexity scoring guide tidak lengkap (hanya Score 1) | Semua request di-score 3, Thinking Mode (`auto_v2`) tidak ter-trigger dengan benar | **Critical** |
| P2 | LLM Call 2 tidak mempertahankan `task` secara verbatim | Intent user hilang, response tidak sesuai ekspektasi | **Critical** |
| P3 | Role selection dihalusinasi oleh LLM | Persona tidak sesuai domain (misal engineer untuk BRD) | **Medium** |
| P4 | Tidak ada JSON Schema enforcement | Risk parsing error, markdown wrapping, hallucinated keys | **Medium** |
| P5 | Turn 1 dan Turn 2+ menggunakan prompt yang sama | Konteks rancu, field role/context muncul di follow-up | **Low** |

---

## 3. Requirements

### 3.1 Functional Requirements

#### FR-1: Perbaiki Prompt Classifier (LLM Call 1)
**Description**: Update prompt `classifyRequestType()` dengan panduan complexity score lengkap (1-5) dan definisi skill yang jelas.

**Acceptance Criteria**:
- [ ] Prompt mencakup panduan Score 1 sampai 5 dengan contoh konkret
- [ ] Prompt mencakup definisi singkat untuk 17 skills (dikelompokkan per kategori)
- [ ] Prompt mencakup aturan klasifikasi kritis (document_qna hanya jika ada dokumen)
- [ ] Output JSON tidak menggunakan markdown formatting
- [ ] Score 4 dan 5 secara eksplisit disebut sebagai trigger Thinking Mode

#### FR-2: Perbaiki Prompt Refinement (LLM Call 2)
**Description**: Pisahkan prompt refinement menjadi 2 mode: Turn 1 (full) dan Turn 2+ (follow-up). Tambahkan penekanan kuat untuk field `task` verbatim.

**Acceptance Criteria**:
- [ ] Turn 1 prompt mencakup field: role, context, task, intent, ambiguities, clarification_needed
- [ ] Turn 2+ prompt HANYA mencakup field: task, intent, ambiguities, clarification_needed (tanpa role/context)
- [ ] Field `task` selalu berisi EXACT verbatim user prompt (tidak diterjemahkan, tidak diringkas)
- [ ] Prompt mengandung warning eksplisit bahwa modifikasi task akan menyebabkan kegagalan sistem

#### FR-3: Hardcode Role Mapping di TypeScript
**Description**: Pindahkan role selection dari LLM ke static mapping di kode TypeScript.

**Acceptance Criteria**:
- [ ] File baru `src/config/skill-role-map.ts` atau konstanta di `routing-engine.service.ts`
- [ ] Mapping mencakup semua 17 skills dengan role yang sesuai domain
- [ ] Role dari LLM Call 2 diabaikan, menggunakan mapping statis
- [ ] Role di-inject ke system prompt inference, bukan ke refinement output

#### FR-4: JSON Schema Enforcement via Bedrock ToolConfig
**Description**: Gunakan fitur `toolConfig` dari AWS Bedrock Converse API untuk memaksa output JSON sesuai schema.

**Acceptance Criteria**:
- [ ] LLM Call 1 menggunakan `toolConfig` dengan schema yang mendefinisikan semua field required
- [ ] LLM Call 2 menggunakan `toolConfig` dengan schema yang berbeda untuk Turn 1 vs Turn 2+
- [ ] Tidak ada lagi parsing JSON manual dengan regex/string manipulation
- [ ] Fallback tetap ada jika toolConfig gagal (graceful degradation)

#### FR-5: Pemisahan Eksplisit Turn 1 vs Turn 2+ di Code
**Description**: Di `routing-engine.service.ts`, tambahkan conditional logic untuk memilih prompt refinement yang tepat berdasarkan `conversationContext`.

**Acceptance Criteria**:
- [ ] Jika `conversationContext` kosong/undefined → gunakan `SKILL_PROMPTS[skill]`
- [ ] Jika `conversationContext` ada → gunakan `FOLLOW_UP_REFINEMENT_PROMPT`
- [ ] Log yang jelas untuk debug: "Using Turn 1 refinement" vs "Using Turn 2+ refinement"

---

### 3.2 Non-Functional Requirements

| # | Requirement | Metric |
|---|-------------|--------|
| NFR-1 | Latency routing | Total routing time < 3000ms (classify + refine + score) |
| NFR-2 | Token efficiency | Prompt refinement Turn 2+ harus lebih pendek dari Turn 1 (min 30% reduction) |
| NFR-3 | Reliability | JSON parsing success rate > 99.9% (dengan toolConfig) |
| NFR-4 | Maintainability | Role mapping mudah di-update tanpa deploy ulang LLM prompt |

---

## 4. Implementation Tasks

### Task 1: Update Classifier Prompt
**File**: `src/services/routing-engine.service.ts`  
**Function**: `classifyRequestType()`

```typescript
// Ganti prompt saat ini dengan:
const CLASSIFIER_PROMPT = `You are an expert intent classifier and complexity scorer for an AI routing engine.
Your task is to classify the user's request into exactly ONE of the 17 supported skills and score its complexity from 1 to 5.

### SUPPORTED SKILLS (Choose exactly one)
[Generation]: email, creative, brainstorming, meta_prompting
[Transformation]: summarization, translation, data_conversion, editing_critique
[Interaction]: roleplay, logic_math, planning_strategy, document_qna
[Enterprise]: requirement_generation, compliance_pre_assessment
[Engineering]: code, log_troubleshooting, general

### CRITICAL CLASSIFICATION RULES
1. \`document_qna\` is ONLY valid if a document is explicitly attached. If NO document is attached, use \`general\`.
2. If the document contains code snippets to be analyzed/fixed, use \`code\`.
3. If the content is strictly financial, legal, or regulatory (e.g., Bank Indonesia compliance), use \`compliance_pre_assessment\`.

### COMPLEXITY SCORING (1-5)
- Score 1: Trivial (greetings, yes/no, simple factual lookup, basic translation of a sentence).
- Score 2: Standard (basic summarization, standard email drafting, simple code generation, general Q&A).
- Score 3: Moderate (analyzing a standard document, multi-step planning, debugging standard logs, data conversion).
- Score 4: Complex (deep compliance/regulatory review, complex logic/math proofs, large document synthesis, multi-domain reasoning). [TRIGGERS THINKING MODE]
- Score 5: Expert (highly abstract strategy, extreme edge-case troubleshooting, massive multi-document synthesis). [TRIGGERS THINKING MODE]

### OUTPUT FORMAT
Return ONLY a raw JSON object. No markdown formatting, no explanations.
{
  "skill": "<one of the 17 skills>",
  "complexity_score": <integer 1-5>,
  "confidence": <float 0.0-1.0>,
  "detected_language": "<iso language code or name>",
  "reasoning": "<brief 1-sentence justification>"
}

### INPUT
User Prompt: {{originalPrompt}}
Document Attached: {{hasDocument}}
Document Context (First 1000 chars): {{maskedDocumentText}}`;
```

### Task 2: Create Separate Refinement Prompts
**File**: `src/services/routing-engine.service.ts`

```typescript
// Prompt untuk Turn 1 (request pertama / ada dokumen)
const SKILL_REFINEMENT_PROMPT = `You are an expert prompt engineer refining a user's request for an AI inference engine.
The user's detected skill is: {{skill}}.

### CRITICAL INSTRUCTION - TASK FIELD
You MUST copy the user's EXACT original prompt VERBATIM in the "task" field.
Example:
- User says: "jelaskan dokumen ini"
- You write: "task": "jelaskan dokumen ini"
- NOT: "task": "explain the document" or "analyze/answer questions"

⚠️ If you modify or translate the task, the system will FAIL.

### INSTRUCTIONS
1. TASK FIELD: Copy user's EXACT original prompt VERBATIM. Do not translate, summarize, or alter a single word.
2. CONTEXT FIELD: Briefly describe the domain/context of the request based on the document.
3. INTENT FIELD: Explain what the user actually wants to achieve (in the user's detected language).

### OUTPUT FORMAT
Return ONLY a raw JSON object.
{
  "context": "<brief context description>",
  "task": "<EXACT VERBATIM USER PROMPT>",
  "intent": "<what the user wants to achieve>",
  "ambiguities": ["<list any missing info>"],
  "clarification_needed": false
}

### INPUT
Original User Prompt: {{originalPrompt}}
Document Context: {{maskedDocumentText}}`;

// Prompt untuk Turn 2+ (follow-up / percakapan berlanjut)
const FOLLOW_UP_REFINEMENT_PROMPT = `You are an expert context-resolver for conversational AI follow-ups.
Users often give short, context-dependent commands (e.g., "translate this", "make it shorter", "fix the bug").

### CRITICAL INSTRUCTION - TASK FIELD
You MUST copy the user's EXACT follow-up prompt VERBATIM in the "task" field.
⚠️ If you modify or translate the task, the system will FAIL.

### INSTRUCTIONS
1. TASK FIELD: Output the user's EXACT follow-up prompt VERBATIM.
2. INTENT FIELD: Resolve what the user is referring to based on the conversation history.

### OUTPUT FORMAT
Return ONLY a raw JSON object.
{
  "task": "<EXACT VERBATIM USER PROMPT>",
  "intent": "<resolved intent referencing history>",
  "ambiguities": [],
  "clarification_needed": false
}

### INPUT
Follow-up Prompt: {{originalPrompt}}
Conversation History: {{conversationContext}}`;
```

### Task 3: Create Role Mapping
**File**: `src/config/skill-role-map.ts` (new file)

```typescript
import { SkillType } from '../types/routing.types';

export const SKILL_TO_ROLE_MAP: Record<SkillType, string> = {
  email: 'Professional Email Writer',
  creative: 'Creative Writer',
  brainstorming: 'Ideation Facilitator',
  meta_prompting: 'Prompt Engineering Expert',
  summarization: 'Information Synthesis Specialist',
  translation: 'Professional Translator',
  data_conversion: 'Data Transformation Specialist',
  editing_critique: 'Editorial Review Expert',
  roleplay: 'Roleplay Character Actor',
  logic_math: 'Mathematics & Logic Expert',
  planning_strategy: 'Strategic Business Consultant',
  document_qna: 'Document Analyst & Researcher',
  requirement_generation: 'Senior Business Analyst',
  compliance_pre_assessment: 'Senior Compliance & Regulatory Auditor',
  code: 'Principal Software Engineer',
  log_troubleshooting: 'DevOps & SRE Expert',
  general: 'General Knowledge Assistant',
};

export function getRoleForSkill(skill: SkillType): string {
  return SKILL_TO_ROLE_MAP[skill] ?? 'General Knowledge Assistant';
}
```

### Task 4: Update Routing Engine Logic
**File**: `src/services/routing-engine.service.ts`

```typescript
import { getRoleForSkill } from '../config/skill-role-map';

// Di dalam refinePrompt() function:
async function refinePrompt(input: RoutingInput, skill: SkillType): Promise<RefinementResult> {
  const isFollowUp = input.conversationContext && input.conversationContext.length > 0;
  
  // Pilih prompt berdasarkan turn
  const promptTemplate = isFollowUp 
    ? FOLLOW_UP_REFINEMENT_PROMPT 
    : SKILL_REFINEMENT_PROMPT;
  
  console.log(`[Routing] Using ${isFollowUp ? 'Turn 2+' : 'Turn 1'} refinement prompt`);
  
  // ... LLM call logic ...
  
  // Hardcode role dari mapping, abaikan dari LLM
  const assignedRole = getRoleForSkill(skill);
  
  return {
    ...llmResponse,
    role: assignedRole, // Override dengan mapping statis
  };
}
```

### Task 5: Add JSON Schema Validation (Post-processing)
**File**: `src/services/routing-engine.service.ts`

```typescript
// Tambahkan validation layer setelah LLM response
function validateRefinementResponse(response: any, originalPrompt: string): RefinementResult {
  // Critical check: task harus verbatim
  if (response.task !== originalPrompt) {
    console.warn(`[Routing] Task mismatch detected. Expected: "${originalPrompt}", Got: "${response.task}"`);
    console.warn('[Routing] Auto-correcting task to verbatim original prompt');
    response.task = originalPrompt; // Force correction
  }
  
  // Validate required fields
  const requiredFields = ['task', 'intent'];
  for (const field of requiredFields) {
    if (!response[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  return response as RefinementResult;
}
```

---

## 5. Test Cases

### Test 1: Classifier Prompt Completeness
```typescript
describe('classifyRequestType', () => {
  it('should return complexity score 4 for compliance document', async () => {
    const input: RoutingInput = {
      originalPrompt: 'Evaluasi kepatuhan dokumen ini terhadap regulasi BI',
      maskedDocumentText: 'Pengamanan Sistem Pembayaran Bank Indonesia...',
      hasDocument: true,
      // ...
    };
    
    const result = await classifyRequestType(input);
    
    expect(result.skill).toBe('compliance_pre_assessment');
    expect(result.complexity_score).toBeGreaterThanOrEqual(4);
  });
  
  it('should return general when no document attached', async () => {
    const input: RoutingInput = {
      originalPrompt: 'Apa itu Jakarta?',
      hasDocument: false,
      // ...
    };
    
    const result = await classifyRequestType(input);
    
    expect(result.skill).toBe('general');
    expect(result.skill).not.toBe('document_qna');
  });
});
```

### Test 2: Refinement Verbatim Preservation
```typescript
describe('refinePrompt', () => {
  it('should preserve task verbatim for Turn 1', async () => {
    const input: RoutingInput = {
      originalPrompt: 'jelaskan dokumen ini',
      maskedDocumentText: 'Business Requirements Document...',
      conversationContext: undefined, // Turn 1
      // ...
    };
    
    const result = await refinePrompt(input, 'document_qna');
    
    expect(result.task).toBe('jelaskan dokumen ini');
    expect(result.task).not.toBe('explain this document');
    expect(result.task).not.toBe('analyze the document');
  });
  
  it('should preserve task verbatim for Turn 2+', async () => {
    const input: RoutingInput = {
      originalPrompt: 'terjemahkan ke bahasa Inggris',
      conversationContext: 'User: jelaskan dokumen ini\nAssistant: Dokumen ini adalah...',
      // ...
    };
    
    const result = await refinePrompt(input, 'translation');
    
    expect(result.task).toBe('terjemahkan ke bahasa Inggris');
    expect(result.role).toBeUndefined(); // Turn 2+ tidak punya role
  });
});
```

### Test 3: Role Mapping
```typescript
describe('getRoleForSkill', () => {
  it('should return correct role for each skill', () => {
    expect(getRoleForSkill('document_qna')).toBe('Document Analyst & Researcher');
    expect(getRoleForSkill('compliance_pre_assessment')).toBe('Senior Compliance & Regulatory Auditor');
    expect(getRoleForSkill('code')).toBe('Principal Software Engineer');
    expect(getRoleForSkill('general')).toBe('General Knowledge Assistant');
  });
});
```

### Test 4: Validation Layer
```typescript
describe('validateRefinementResponse', () => {
  it('should auto-correct task mismatch', () => {
    const response = { task: 'analyze the document', intent: '...' };
    const originalPrompt = 'jelaskan dokumen ini';
    
    const result = validateRefinementResponse(response, originalPrompt);
    
    expect(result.task).toBe('jelaskan dokumen ini');
  });
  
  it('should throw on missing required fields', () => {
    const response = { intent: '...' }; // missing task
    const originalPrompt = 'test';
    
    expect(() => validateRefinementResponse(response, originalPrompt))
      .toThrow('Missing required field: task');
  });
});
```

---

## 6. Migration Notes

### Breaking Changes
- **Tidak ada breaking changes** untuk API eksternal
- Internal: `RefinementResult` interface mungkin perlu update jika field `role` dihapus dari LLM output
