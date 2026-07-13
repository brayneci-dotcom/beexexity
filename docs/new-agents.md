# `beexexity` — Next-Generation Agent Architecture
## Official Requirement Proposal v3.0

**Date:** July 13, 2026  
**Version:** 3.0 (Final)  
**Scope:** Evolution from "Smart Prompt Router" to "Self-Correcting Multi-Task Agent"  
**Infrastructure:** GCP Cloud Run (Compute) + GCP Cloud SQL (DB - Future) + AWS Bedrock (LLM)  
**Current DB:** AWS RDS PostgreSQL (will migrate to GCP Cloud SQL in separate phase)

---

## Executive Summary

`beexexity` is a production-grade AI inference gateway with 20 deterministic skills, complexity scoring, dual execution paths (`auto` single-shot vs `auto_v2` sequential reasoning), and robust guardrails (PII masking, verification, semantic judging). 

This proposal transforms `beexexity` into a **self-correcting, self-improving multi-task agent** while preserving all existing security, compliance, and performance characteristics. The transformation addresses three critical bottlenecks:

1. **Fragile Skill Identification:** Current single-call LLM classifier risks hallucination
2. **Rigid Execution Pipelines:** `auto` and `auto_v2` are separate code paths with inflexible planning
3. **Reactive Quality Control:** Failures are repaired post-hoc; system doesn't learn

**Key Principle:** Evolve incrementally. Keep all deterministic guardrails, PII masking, and verification logic intact. Transform orchestration layer only.

---

## 1. Goals & Non-Goals

### Goals

| ID | Goal | Success Metric |
|----|------|----------------|
| G1 | Eliminate LLM-hallucinated skill routing | 0% skill hallucination rate in 30-day production test |
| G2 | Unify `auto` and `auto_v2` into single dynamic agent | Single code path; simple queries = 1 loop, complex = N loops |
| G3 | Enable multi-task execution with real-time context adaptation | Agent can change plan mid-execution based on retrieved data |
| G4 | Introduce deterministic self-correction before user sees output | Verification failures trigger automatic retry loops (max 2) |
| G5 | Build auto self-improvement engine that learns from failures | Background process proposes & applies prompt/few-shot fixes |
| G6 | Preserve all existing guardrails | Zero regression in security/compliance posture |
| G7 | Protect latency under GCP + AWS Bedrock topology | p95 latency ≤ current baseline for simple queries |
| G8 | Support 20-skill taxonomy | All new skills (`risk_analyst`, `process_optimization`, `data_analysis`) fully integrated |

### Non-Goals

- ❌ Migrate away from AWS Bedrock
- ❌ Adopt LangGraph.js / Vercel AI SDK as runtime dependencies (steal patterns only)
- ❌ Import AutoGPT's platform or Python stack
- ❌ Migrate database during code refactor (separate infrastructure phase)
- ❌ Log full prompt/response content (privacy constraint absolute)
- ❌ Remove existing verification/repair pipeline (enhance it)

---

## 2. Current State Assessment

### 2.1 What We Keep (Do Not Touch)

| Component | File/Location | Reason |
|-----------|---------------|--------|
| Skill-Role Map (20 skills) | `src/config/skill-role-map.ts` | Deterministic, prevents LLM role hallucination |
| PII Masker (fail-closed) | `src/services/pii-masker.service.ts` | Indonesian PII compliance, zero-trust |
| Deterministic Verification | `verifyOutput()` in `routing-engine.service.ts` | Contract enforcement without LLM trust |
| Semantic Judge | `semanticJudge()` in `routing-engine.service.ts` | High-stakes skill validation |
| PG Advisory Lock | `tryAcquireSessionLock()` in `config/database.ts` | Distributed turn safety across Cloud Run |
| SSE Event Protocol | `inference.routes.ts` + `public/index.html` | Frontend integration stable |
| Three-Tier Session Memory | `session-memory.service.ts` + `context-assembly.service.ts` | Working, battle-tested |
| Feedback System | `feedback.routes.ts` + `feedback_reports` table | Foundation for self-improvement |
| File Signature Validator | `file-signature-validator.ts` | MIME spoofing defense |
| OCR Pipeline | Two-stage Nova Lite → GPT-OSS | Prevents document hallucination |
| Document Extractor | `document-extractor.service.ts` | Format-aware extraction |

### 2.2 What We Replace

| Current | Problem | Replacement |
|---------|---------|-------------|
| `unifiedClassifyAndScore()` (single LLM call) | LLM guesses skill; hallucination risk | **Intent-First Router** (LLM extracts intent → deterministic code resolves skill) |
| `auto` single-shot path | No tool use, no multi-step capability | **Unified ReAct Agent Graph** |
| `auto_v2` static planner/executor | Blind plan execution; no mid-flight adaptation | **Unified ReAct Agent Graph** (same code path) |
| `repairResponse()` (post-hoc, fire-and-forget) | User sees broken output before repair | **Reflector Node** (verification inside loop, retry before streaming) |
| Scattered Bedrock SDK calls | Tight coupling, hard to test | **`BedrockProvider` abstraction** (Vercel pattern) |
| Background `synthesizeReport()` (feedback only) | Reactive, no systemic learning | **Meta-Evaluator Cloud Run Job** (proactive self-improvement) |

---

## 3. Updated Skill Taxonomy (20 Skills)

### 3.1 Skill Groups

| Group | Skills | Count |
|-------|--------|-------|
| **Generation** | `business_writing`, `creative_writing`, `brainstorming`, `prompt_optimizer` | 4 |
| **Transformation** | `summarization`, `translation`, `data_transformation`, `editing` | 4 |
| **Interaction** | `roleplay`, `logic_math`, `planning_strategy`, `document_analysis` | 4 |
| **Enterprise** | `requirement_generation`, `compliance_pre_assessment`, `risk_analyst`, `process_optimization` | 4 |
| **Engineering** | `code`, `log_troubleshooting`, `data_analysis` | 3 |
| **Fallback** | `fallback` | 1 |
| **Total** | | **20** |

### 3.2 Skill Changes from Original 17

| Type | Count | Details |
|------|-------|---------|
| **Renamed** | 7 | `email`→`business_writing`, `creative`→`creative_writing`, `meta_prompting`→`prompt_optimizer`, `data_conversion`→`data_transformation`, `editing_critique`→`editing`, `document_qna`→`document_analysis`, `general`→`fallback` |
| **New** | 3 | `risk_analyst`, `process_optimization`, `data_analysis` |

### 3.3 Critical Classifier Rules

1. **`document_analysis`** is ONLY valid when a document is actually attached. If no document, general knowledge Q&A falls to `fallback`.
2. **`compliance_pre_assessment`** is STRICTLY reserved for legal/financial/tax/regulatory documents. Never for technical/architectural/engineering documents.
3. **`risk_analyst`** requires risk/threat/vulnerability context AND complexity ≥ 3.
4. **`data_analysis`** requires structured data (CSV/Excel/JSON) AND statistical/analytical intent.
5. **`process_optimization`** requires workflow/process improvement context.
6. Document containing code → `code`. Financial/regulatory/legal → `compliance_pre_assessment`.

### 3.4 Updated Skill-Role Map

```typescript
export const SKILL_TO_ROLE: Record<SkillType, string> = {
  // Generation
  business_writing: 'Business & Professional Communication Specialist',
  creative_writing: 'Creative Writer & Storyteller',
  brainstorming: 'Innovation & Ideation Facilitator',
  prompt_optimizer: 'Prompt Strategy & Optimization Consultant',

  // Transformation
  summarization: 'Information Synthesis Specialist',
  translation: 'Professional Multilingual Translator',
  data_transformation: 'Data Format & Schema Conversion Specialist',
  editing: 'Editorial Review & Proofreading Expert',

  // Interaction
  roleplay: 'Character Roleplay Actor',
  logic_math: 'Mathematics & Logic Problem Solver',
  planning_strategy: 'Strategic Planning & Business Consultant',
  document_analysis: 'Document Intelligence & Research Analyst',

  // Enterprise
  requirement_generation: 'Senior Business & Requirements Analyst',
  compliance_pre_assessment: 'Senior Compliance & Regulatory Auditor',
  risk_analyst: 'Risk Assessment & Mitigation Specialist',
  process_optimization: 'Business Process Improvement Consultant',

  // Engineering
  code: 'Principal Software Engineer',
  log_troubleshooting: 'DevOps & Site Reliability Engineer',
  data_analysis: 'Data Insights & Statistical Analyst',

  // Fallback
  fallback: 'General Purpose Assistant',
}
```

---

## 4. Proposed Architecture

### 4.1 Layer 1: Provider Abstraction (Vercel Pattern, Bedrock Native)

**Objective:** Decouple business logic from AWS SDK.

**File Structure:**
```
src/providers/
├── llm-provider.interface.ts    # Abstract interface
└── bedrock-provider.ts          # @aws-sdk/client-bedrock-runtime implementation
```

**Interface Contract:**
```typescript
interface LLMProvider {
  generateText(params: GenerateTextParams): Promise<string>;
  streamText(params: StreamTextParams): AsyncIterable<string>;
  generateObject<T>(params: GenerateObjectParams<T>): Promise<T>;
}

interface GenerateTextParams {
  modelId: string;
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

interface GenerateObjectParams<T> extends GenerateTextParams {
  schema: JSONSchemaType<T>;
}
```

**Migration Tasks:**
- Create `src/providers/` directory
- Implement `LLMProvider` interface
- Implement `BedrockProvider` with AWS SDK
- Update all services to use provider:
  - `routing-engine.service.ts` (classify, score, refine)
  - `sequential-reasoning.service.ts` (planner, executor, synthesizer)
  - `inference.service.ts` (generate, semanticJudge, repairResponse)
- Add unit tests for provider layer

**Benefit:** Isolates AWS SDK changes. Makes testing easier (mock provider, not SDK).

---

### 4.2 Layer 2: Intent-First Router (Replaces `unifiedClassifyAndScore`)

**Objective:** Eliminate skill hallucination by separating intent extraction (LLM) from skill resolution (deterministic code).

**File:** `src/services/intent-router.service.ts` (new)

**Three-Step Pipeline:**

#### Step 1: Deterministic Pre-Gating (Zero LLM cost)

```typescript
function applyDeterministicGates(input: RoutingInput): SkillType | null {
  // Silent upload (files, no text) → document_analysis
  if (input.hasFiles && !input.originalPrompt.trim()) {
    return 'document_analysis';
  }
  
  // Code blocks or .py/.js files → code
  if (input.originalPrompt.includes('```') || hasCodeFile(input.files)) {
    return 'code';
  }
  
  // Regulatory keywords + financial docs → compliance_pre_assessment
  if (input.originalPrompt.match(/compliance|regulatory|legal|tax|kepatuhan/) && 
      input.files?.some(f => isFinancialDocument(f))) {
    return 'compliance_pre_assessment';
  }
  
  return null;
}
```

#### Step 2: LLM Intent & Constraint Extraction

**Model:** `qwen.qwen3-32b-v1:0` (temp=0, maxTokens=200)

**Prompt:** "Extract intent from this request. Do NOT guess the skill."

**Output Schema:**
```typescript
interface IntentExtraction {
  core_intent: string;                    // e.g., "Extract and compare financial margins"
  required_data: string[];                // e.g., ["document_text", "historical_context"]
  output_constraints: string[];           // e.g., ["json_array", "no_markdown"]
  complexity_indicators: string[];        // e.g., ["multi_step", "strict_format"]
}
```

**⚠️ Critical:** NEVER asks "what skill is this?"

#### Step 3: Deterministic Skill Resolution

```typescript
function resolveSkillFromIntent(intent: IntentExtraction, input: RoutingInput): SkillType {
  const { core_intent, required_data } = intent;
  
  // Map intent keywords to skills (all 20)
  const skillKeywords: Record<SkillType, string[]> = {
    business_writing: ['email', 'business letter', 'professional communication', 'surat dinas'],
    document_analysis: ['analyze document', 'document qna', 'extract from', 'tanya dokumen'],
    data_analysis: ['analyze data', 'statistical', 'trend', 'insight', 'analisis data'],
    risk_analyst: ['risk', 'threat', 'vulnerability', 'mitigation', 'risiko'],
    process_optimization: ['optimize process', 'workflow', 'efficiency', 'efisiensi'],
    // ... all 20 skills
    fallback: [],
  };
  
  // Find best match
  for (const [skill, keywords] of Object.entries(skillKeywords)) {
    if (keywords.some(k => core_intent.toLowerCase().includes(k))) {
      // Validate skill requirements
      if (skill === 'document_analysis' && !required_data.includes('document_text')) {
        return 'fallback'; // Demote if no document
      }
      if (skill === 'risk_analyst' && !core_intent.match(/risk|threat|vulnerability/)) {
        return 'fallback';
      }
      return skill as SkillType;
    }
  }
  
  return 'fallback';
}
```

**Complexity Scoring:**
```typescript
function scoreComplexityFromIndicators(indicators: string[]): number {
  let score = 1;
  if (indicators.includes('multi_step')) score += 1;
  if (indicators.includes('strict_format')) score += 1;
  if (indicators.includes('full_document_evaluation')) score = 5;
  if (indicators.includes('3+ questions')) score = Math.max(score, 4);
  return Math.min(score, 5);
}
```

**Migration Tasks:**
- Create `src/services/intent-router.service.ts`
- Implement three-step pipeline
- Update `inference.routes.ts` to call new router
- Deprecate `unifiedClassifyAndScore()`
- A/B test new router vs old on staging
- Validate 0% skill hallucination over 1000 test prompts

---

### 4.3 Layer 3: Unified ReAct Agent Graph (Replaces `auto` + `auto_v2`)

**Objective:** Single execution path that naturally handles both simple and complex queries via a Reason → Act → Observe loop.

**File:** `src/services/agent-graph.service.ts` (new)

**Graph Topology:**

```
                    ┌──────────────────┐
                    │  Input Analyzer  │ (Intent-First Router)
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │   REASON Node    │ ◄──────────────────────┐
                    │  (LLM decides)   │                        │
                    └────────┬─────────┘                        │
                             │                                  │
                 ┌───────────┴───────────┐                      │
                 ▼                       ▼                      │
        execute_step              generate_final_response       │
                 │                       │                      │
                 ▼                       │                      │
        ┌──────────────────┐             │                      │
        │    ACT Node      │             │                      │
        │ (Tool execution) │             │                      │
        └────────┬─────────┘             │                      │
                 │                       │                      │
                 └───────────┬───────────┘                      │
                             ▼                                  │
                    ┌──────────────────┐                        │
                    │  OBSERVE Node    │                        │
                    │ (Verify + Judge) │                        │
                    └────────┬─────────┘                        │
                             │                                  │
                 ┌───────────┴───────────┐                      │
                 ▼                       ▼                      │
          [PASS] → Synthesize     [FAIL & retry<2] ────────────┘
                 │                       │
                 ▼                       ▼
          Stream to user          Inject error_feedback
                                   into AgentState
```

**Key Design Decisions:**

1. **Unified Path:** Simple queries naturally exit at `generate_final_response` on Loop 1. Complex queries loop N times. Same code.
2. **Hard Limit:** `MAX_AGENT_LOOPS = 6` (replaces `MAX_SEQUENTIAL_STEPS`).
3. **Self-Correction Edge:** When `verifyOutput()` fails, the violation is injected as `error_feedback` into the state. The next REASON loop sees the error and adapts.
4. **PII Per Step:** Fail-closed masking on every tool input/output (preserves existing security posture).

**Implementation:**

```typescript
export class AgentGraph {
  private provider: LLMProvider;
  private maxLoops: number = 6;
  
  async execute(input: AgentInput, res: Response): Promise<AgentResult> {
    const state: AgentState = {
      originalPrompt: input.prompt,
      contract: input.contract,
      context: [],
      stepCount: 0,
      retryCount: 0,
      errorFeedback: null,
    };
    
    // REACT LOOP: Reason → Act → Observe
    while (state.stepCount < this.maxLoops) {
      // NODE 1: REASON
      const reasonOutput = await this.reasonNode(state);
      
      if (reasonOutput.action === 'generate_final_response') {
        // Exit loop
        break;
      }
      
      // NODE 2: ACT
      const actOutput = await this.actNode(reasonOutput.step_definition, state);
      state.context.push(actOutput);
      
      // NODE 3: OBSERVE (Verification)
      const observeOutput = await this.observeNode(state, actOutput);
      
      if (!observeOutput.passed && state.retryCount < 2) {
        // Self-correction: inject error feedback
        state.errorFeedback = observeOutput.violations;
        state.retryCount++;
        // Loop back to REASON
        continue;
      }
      
      state.stepCount++;
    }
    
    // SYNTHESIZE final response
    const finalResponse = await this.synthesizeNode(state);
    
    return { text: finalResponse, state };
  }
}
```

**Tool Registry:**

```typescript
// src/tools/tool-registry.ts
export const TOOL_REGISTRY: Record<SkillType, Tool[]> = {
  // Existing skills
  business_writing: ['query_memory'],
  document_analysis: ['extract_document', 'query_memory', 'semantic_search'],
  code: ['query_memory'],
  compliance_pre_assessment: ['extract_document', 'query_memory', 'compliance_checker'],
  
  // NEW skills
  risk_analyst: [
    'extract_document',
    'query_memory',
    'risk_assessment_framework', // NEW tool
    'compliance_checker',
  ],
  process_optimization: [
    'extract_document',
    'query_memory',
    'process_mapping', // NEW tool
    'bottleneck_analyzer', // NEW tool
  ],
  data_analysis: [
    'extract_document', // For CSV/Excel
    'query_memory',
    'statistical_analysis', // NEW tool
    'data_visualization_prep', // NEW tool
  ],
  
  fallback: ['query_memory'],
};
```

**New Tool Implementations:**

```typescript
// src/tools/risk-assessment.tool.ts
export async function riskAssessmentFramework(context: string): Promise<string> {
  // ISO 31000 or NIST framework application
  // Identifies threats, vulnerabilities, impacts
  // Returns structured risk matrix
}

// src/tools/process-mapping.tool.ts
export async function processMapping(context: string): Promise<string> {
  // BPMN-style process decomposition
  // Identifies steps, owners, inputs/outputs
}

// src/tools/bottleneck-analyzer.tool.ts
export async function bottleneckAnalyzer(processMap: string): Promise<string> {
  // Identifies delays, resource constraints
}

// src/tools/statistical-analysis.tool.ts
export async function statisticalAnalysis(data: string): Promise<string> {
  // Descriptive stats, correlations, trends
  // Uses simple statistical formulas or calls Bedrock
}
```

**SSE Events:**

```typescript
// Updated events for agent graph
event: agent_thought     { step: 1, thought: "I need to extract text..." }
event: agent_action      { step: 1, action: "Executing document extraction..." }
event: agent_observation { step: 1, status: "passed" | "failed", feedback: "..." }
```

**Migration Tasks:**
- Create `src/services/agent-graph.service.ts`
- Create `src/tools/tool-registry.ts`
- Implement REASON/ACT/OBSERVE loop
- Wrap existing services as tools
- Implement new tools for 3 new skills
- Integrate `verifyOutput()` + `semanticJudge()` into OBSERVE node
- Update SSE events
- Update `inference.routes.ts` to use AgentGraph
- Deprecate `sequential-reasoning.service.ts` and sub-agent services
- Load test: verify p95 latency ≤ current baseline

---

### 4.4 Layer 4: Auto Self-Improvement System

**Objective:** Background process that learns from failures and proposes systemic fixes.

**Privacy Constraint:** Audit logs contain metadata only. We create a *separate, restricted* capture table for improvement candidates, strictly PII-masked.

#### 4.4.1 Failure Capture Pipeline

**New Migration:** `015_improvement_candidates.sql`

```sql
CREATE TABLE improvement_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  skill VARCHAR(50) NOT NULL,
  failure_source VARCHAR(20) NOT NULL,  -- 'deterministic_verify' | 'semantic_judge' | 'user_feedback'
  masked_input TEXT NOT NULL,           -- PII-masked user prompt
  masked_output TEXT NOT NULL,          -- PII-masked assistant response
  violation_details JSONB NOT NULL,     -- e.g., { "missing_elements": ["conclusion"] }
  routing_metadata JSONB NOT NULL,
  evaluated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_improvement_candidates_unevaluated 
  ON improvement_candidates(skill, failure_source) 
  WHERE evaluated = false;
```

**Hooks:**

```typescript
// In verifyOutput()
if (!verification.passed) {
  await db.query(`
    INSERT INTO improvement_candidates 
    (session_id, skill, failure_source, masked_input, masked_output, violation_details, routing_metadata)
    VALUES ($1, $2, 'deterministic_verify', $3, $4, $5, $6)
  `, [
    sessionId, 
    skill, 
    await piiMasker.mask(userPrompt), 
    await piiMasker.mask(assistantResponse), 
    JSON.stringify(verification.violations),
    JSON.stringify(routingMetadata)
  ]);
}

// In semanticJudge()
if (!semantic.is_correct) {
  await db.query(`
    INSERT INTO improvement_candidates 
    (session_id, skill, failure_source, masked_input, masked_output, violation_details, routing_metadata)
    VALUES ($1, $2, 'semantic_judge', $3, $4, $5, $6)
  `, [
    sessionId, 
    skill, 
    await piiMasker.mask(userPrompt), 
    await piiMasker.mask(assistantResponse), 
    JSON.stringify({ missing_elements: semantic.missing_elements }),
    JSON.stringify(routingMetadata)
  ]);
}

// In feedback.routes.ts (user submits negative feedback)
await db.query(`
  INSERT INTO improvement_candidates 
  (session_id, skill, failure_source, masked_input, masked_output, violation_details, routing_metadata)
  VALUES ($1, $2, 'user_feedback', $3, $4, $5, $6)
`, [
  sessionId, 
  skill, 
  await piiMasker.mask(userPrompt), 
  await piiMasker.mask(finalResponse), 
  JSON.stringify({ user_feedback: userFeedback, error_category: errorCategory }),
  JSON.stringify(routingMetadata)
]);
```

#### 4.4.2 Meta-Evaluator Background Job

**Deployment:** GCP Cloud Run Job, triggered by GCP Cloud Scheduler (daily at 02:00 WIB).

**File:** `src/services/meta-evaluator.service.ts` (new)

**Flow:**

```typescript
export class MetaEvaluator {
  async evaluateFailures(): Promise<void> {
    // Query unevaluated failures, group by skill + failure_source
    const clusters = await db.query(`
      SELECT skill, failure_source, 
             COUNT(*) as count,
             ARRAY_AGG(id) as ids,
             ARRAY_AGG(masked_input || '|||' || masked_output) as examples
      FROM improvement_candidates 
      WHERE evaluated = false 
      GROUP BY skill, failure_source 
      HAVING COUNT(*) >= 3
    `);
    
    for (const cluster of clusters.rows) {
      // Analyze root cause via Bedrock
      const analysis = await this.analyzeCluster(cluster);
      
      // Generate proposed fix
      const proposal = await this.generateProposal(analysis, cluster.skill);
      
      // Store in dynamic configs
      await db.query(`
        INSERT INTO dynamic_system_configs 
        (config_key, config_value, generated_by_model, confidence_score, status)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (config_key) DO UPDATE SET 
          config_value = EXCLUDED.config_value,
          generated_by_model = EXCLUDED.generated_by_model,
          confidence_score = EXCLUDED.confidence_score,
          updated_at = NOW()
      `, [
        proposal.configKey, 
        JSON.stringify(proposal.configValue), 
        'qwen3-235b', 
        proposal.confidence,
        proposal.confidence >= 0.90 ? 'approved' : 'pending'
      ]);
      
      // Mark candidates as evaluated
      await db.query(`
        UPDATE improvement_candidates 
        SET evaluated = true 
        WHERE id = ANY($1)
      `, [cluster.ids]);
    }
  }
  
  private async analyzeCluster(cluster: FailureCluster): Promise<RootCauseAnalysis> {
    const provider = new BedrockProvider();
    
    return await provider.generateObject<RootCauseAnalysis>({
      modelId: 'qwen.qwen3-235b-a22b-2507-v1:0',
      prompt: `Analyze these ${cluster.count} failures for skill ${cluster.skill}:
               
               Examples:
               ${cluster.examples.slice(0, 5).join('\n\n')}
               
               Identify the root cause pattern.`,
      schema: rootCauseSchema,
    });
  }
  
  private async generateProposal(
    analysis: RootCauseAnalysis, 
    skill: string
  ): Promise<ImprovementProposal> {
    const provider = new BedrockProvider();
    
    // Determine target system based on analysis
    let configKey: string;
    let configValue: any;
    
    if (analysis.suggests_few_shot) {
      configKey = `few_shot_${skill}`;
      configValue = await provider.generateObject<FewShotEntry>({
        modelId: 'qwen.qwen3-235b-a22b-2507-v1:0',
        prompt: `Generate a few-shot example that addresses this failure pattern:
                 ${analysis.root_cause}`,
        schema: fewShotSchema,
      });
    } else if (analysis.suggests_refinement_rule) {
      configKey = 'global_refinement_rules';
      configValue = await provider.generateText({
        modelId: 'qwen.qwen3-235b-a22b-2507-v1:0',
        prompt: `Generate a global refinement rule that addresses this failure pattern:
                 ${analysis.root_cause}`,
      });
    }
    
    return {
      configKey,
      configValue,
      confidence: analysis.confidence,
    };
  }
}
```

#### 4.4.3 Dynamic Config Table

**New Migration:** `016_dynamic_system_configs.sql`

```sql
CREATE TABLE dynamic_system_configs (
  config_key VARCHAR(100) PRIMARY KEY,   -- e.g., 'few_shot_data_analysis'
  config_value JSONB NOT NULL,
  generated_by_model VARCHAR(50),
  confidence_score FLOAT,
  status VARCHAR(20) DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  approved_by VARCHAR(64),
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dynamic_system_configs_status 
  ON dynamic_system_configs(status) 
  WHERE status = 'approved';
```

**Runtime Injection:**

```typescript
// In inference.routes.ts (Step 16: Inject few-shot examples)
const dynamicFewShots = await db.query(`
  SELECT config_value FROM dynamic_system_configs 
  WHERE config_key = $1 AND status = 'approved'
`, [`few_shot_${skill}`]);

let fewShots: FewShotEntry[];
if (dynamicFewShots.rows.length > 0) {
  fewShots = dynamicFewShots.rows[0].config_value;
} else {
  fewShots = FEW_SHOTS[skill] || [];
}

// In routing-engine.service.ts (refinePrompt)
const dynamicRules = await db.query(`
  SELECT config_value FROM dynamic_system_configs 
  WHERE config_key = 'global_refinement_rules' AND status = 'approved'
`);

let refinementRules = GLOBAL_REFINEMENT_RULES;
if (dynamicRules.rows.length > 0) {
  refinementRules += '\n\n' + dynamicRules.rows[0].config_value;
}
```

**Admin UI:**
- Add new tab in `admin.html`: "System Improvements"
- Show pending proposals with confidence scores
- Allow approve/reject with admin username
- Show history of applied improvements

**Migration Tasks:**
- Run migration `015_improvement_candidates.sql`
- Run migration `016_dynamic_system_configs.sql`
- Hook failure capture into `verifyOutput()`, `semanticJudge()`, feedback
- Create `src/services/meta-evaluator.service.ts`
- Deploy as GCP Cloud Run Job
- Configure GCP Cloud Scheduler (daily at 02:00 WIB)
- Add admin UI tab for proposal review
- Wire runtime injection in `inference.routes.ts` and `routing-engine.service.ts`

---

### 4.5 Layer 5: Verification Layer Updates

**File:** `src/services/routing-engine.service.ts`

**Update `SEMANTIC_VERIFY_SKILLS`:**

```typescript
// NEW: Add high-stakes skills
const SEMANTIC_VERIFY_SKILLS = [
  'compliance_pre_assessment',
  'logic_math',
  'document_analysis', // RENAMED from document_qna
  'code',
  'risk_analyst', // NEW (high-stakes)
  'data_analysis', // NEW (requires accuracy)
];
```

**Add Skill-Specific Verification Rules:**

```typescript
export function verifyOutput(
  output: string,
  contract: PromptContract
): VerificationResult {
  const violations: VerificationViolation[] = [];
  
  // ... existing checks (empty, word count, required sections, forbidden content) ...
  
  // NEW: Skill-specific checks
  if (contract.skill === 'risk_analyst') {
    if (!output.includes('Likelihood') || !output.includes('Impact')) {
      violations.push({
        type: 'missing_elements',
        field: 'risk_matrix',
        message: 'Risk assessment must include likelihood and impact matrix',
      });
    }
    if (!output.includes('Mitigation')) {
      violations.push({
        type: 'missing_elements',
        field: 'mitigation',
        message: 'Each risk must have mitigation strategy',
      });
    }
  }
  
  if (contract.skill === 'process_optimization') {
    if (!output.includes('Current State') || !output.includes('Optimized')) {
      violations.push({
        type: 'missing_elements',
        field: 'before_after',
        message: 'Must show current state and optimized state comparison',
      });
    }
    if (!output.match(/\d+%|\d+ hours?|\d+ days?/)) {
      violations.push({
        type: 'missing_elements',
        field: 'metrics',
        message: 'Must include quantitative improvement metrics',
      });
    }
  }
  
  if (contract.skill === 'data_analysis') {
    if (!output.match(/mean|median|average|std dev|correlation/i)) {
      violations.push({
        type: 'missing_elements',
        field: 'statistics',
        message: 'Must include statistical measures',
      });
    }
    if (!output.includes('Insight') || !output.includes('Recommendation')) {
      violations.push({
        type: 'missing_elements',
        field: 'actionable_insight',
        message: 'Must provide insights and recommendations',
      });
    }
  }
  
  return {
    passed: violations.length === 0,
    violations,
  };
}
```

---

### 4.6 Layer 6: Few-Shot Library Updates

**File:** `src/services/few-shot-library.ts`

**Add Entries for New Skills:**

```typescript
export const FEW_SHOTS: Record<SkillType, FewShotEntry[]> = {
  // Keep existing entries (renamed skills)
  business_writing: [/* ... */],
  brainstorming: [/* ... */],
  summarization: [/* ... */],
  data_transformation: [/* ... */],
  editing: [/* ... */],
  document_analysis: [/* renamed from document_qna */],
  code: [/* ... */],
  compliance_pre_assessment: [/* ... */],
  
  // NEW entries
  risk_analyst: [
    {
      input: "Analyze the security risks in this cloud architecture document.",
      output: `## Risk Assessment

| Threat | Likelihood | Impact | Mitigation |
|--------|-----------|--------|------------|
| Unauthorized access | Medium | High | Implement MFA, IAM policies |
| Data breach | Low | Critical | Encryption at rest/transit |
| DDoS attack | Medium | Medium | WAF, rate limiting |

**Residual Risk:** Medium - requires quarterly review`,
    },
  ],
  
  process_optimization: [
    {
      input: "Optimize this order fulfillment process that takes 5 days.",
      output: `## Current State
1. Order received → Manual entry (2h)
2. Inventory check → Email warehouse (4h)
3. Picking → Manual walk (6h)
4. Packing → Manual (2h)
5. Shipping → Daily batch (24h)

**Total:** 5 days

## Optimized State
1. Order received → Auto-entry (5min)
2. Inventory check → Real-time API (1min)
3. Picking → Optimized route (3h)
4. Packing → Automated labeling (1h)
5. Shipping → Real-time pickup (2h)

**Total:** 6 hours (93% reduction)

**Bottleneck eliminated:** Daily shipping batch`,
    },
  ],
  
  data_analysis: [
    {
      input: "Analyze this sales data and identify trends.",
      output: `## Statistical Summary
- **Mean:** $45,230/month
- **Median:** $42,100/month
- **Std Dev:** $8,450
- **Growth Rate:** 12.3% QoQ

## Key Insights
1. **Seasonal Pattern:** 35% higher sales in Q4
2. **Correlation:** Marketing spend (r=0.78) strongly correlated with revenue
3. **Outlier:** March 2026 spike (+67%) due to product launch

## Recommendation
Increase Q4 marketing budget by 25% to capture seasonal demand.`,
    },
  ],
  
  // Empty arrays (rely on refinement prompt)
  creative_writing: [],
  translation: [],
  logic_math: [],
  planning_strategy: [],
  requirement_generation: [],
  prompt_optimizer: [],
  log_troubleshooting: [],
  fallback: [],
};
```

---

### 4.7 Layer 7: GCP Topology Alignment

**Objective:** Ensure the new architecture performs optimally under GCP Compute + AWS Bedrock (DB migration is separate phase).

| Concern | Strategy |
|---------|----------|
| Active graph state | Keep in Cloud Run memory (no DB writes during loop) |
| Session locks | Continue using PG advisory locks (current AWS RDS, future GCP Cloud SQL) |
| Cross-cloud LLM calls | Use GCP Workload Identity Federation → AWS IAM (no static keys) |
| Telemetry writes | Async fire-and-forget to DB after response completes |
| Network security | TLS 1.3 enforced; consider AWS Direct Connect ↔ GCP Cloud Interconnect for PII traffic |

**Implementation:**

```typescript
// In agent-graph.service.ts
async execute(input: AgentInput, res: Response): Promise<AgentResult> {
  const state: AgentState = { /* ... */ };
  
  // REACT LOOP (all in memory, no DB writes)
  while (state.stepCount < this.maxLoops) {
    // REASON, ACT, OBSERVE nodes
    // All state updates in memory
  }
  
  // Stream final response
  await this.streamResponse(state, res);
  
  // AFTER response sent: async telemetry
  setImmediate(async () => {
    await auditService.logAgentTrajectory(state);
  });
}
```

---

## 5. Database Schema Changes

### 5.1 Migration `015_improvement_candidates.sql`

```sql
-- Capture PII-masked failure data for self-improvement
CREATE TABLE improvement_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  skill VARCHAR(50) NOT NULL,
  failure_source VARCHAR(20) NOT NULL,
  masked_input TEXT NOT NULL,
  masked_output TEXT NOT NULL,
  violation_details JSONB NOT NULL,
  routing_metadata JSONB NOT NULL,
  evaluated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_improvement_candidates_unevaluated 
  ON improvement_candidates(skill, failure_source) 
  WHERE evaluated = false;
```

### 5.2 Migration `016_dynamic_system_configs.sql`

```sql
-- Store AI-proposed prompt/few-shot improvements
CREATE TABLE dynamic_system_configs (
  config_key VARCHAR(100) PRIMARY KEY,
  config_value JSONB NOT NULL,
  generated_by_model VARCHAR(50),
  confidence_score FLOAT,
  status VARCHAR(20) DEFAULT 'pending',
  approved_by VARCHAR(64),
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dynamic_system_configs_status 
  ON dynamic_system_configs(status) 
  WHERE status = 'approved';
```

### 5.3 Migration `017_agent_trajectories.sql`

```sql
-- Store full graph executions for debugging
ALTER TABLE audit_logs 
ADD COLUMN agent_trajectory JSONB;

CREATE INDEX idx_audit_logs_trajectory 
  ON audit_logs(agent_trajectory) 
  WHERE agent_trajectory IS NOT NULL;
```

### 5.4 Migration `018_update_skill_taxonomy.sql`

```sql
-- Update CHECK constraints on tables that reference skills

-- 1. Update audit_logs skill constraint
ALTER TABLE audit_logs 
  DROP CONSTRAINT IF EXISTS audit_logs_skill_check,
  ADD CONSTRAINT audit_logs_skill_check 
    CHECK (routing_skill IN (
      'business_writing', 'creative_writing', 'brainstorming', 'prompt_optimizer',
      'summarization', 'translation', 'data_transformation', 'editing',
      'roleplay', 'logic_math', 'planning_strategy', 'document_analysis',
      'requirement_generation', 'compliance_pre_assessment', 'risk_analyst', 
      'process_optimization', 'code', 'log_troubleshooting', 'data_analysis',
      'fallback'
    ));

-- 2. Update feedback_reports skill constraint
ALTER TABLE feedback_reports 
  DROP CONSTRAINT IF EXISTS feedback_reports_skill_check,
  ADD CONSTRAINT feedback_reports_skill_check 
    CHECK (skill IN (
      'business_writing', 'creative_writing', 'brainstorming', 'prompt_optimizer',
      'summarization', 'translation', 'data_transformation', 'editing',
      'roleplay', 'logic_math', 'planning_strategy', 'document_analysis',
      'requirement_generation', 'compliance_pre_assessment', 'risk_analyst', 
      'process_optimization', 'code', 'log_troubleshooting', 'data_analysis',
      'fallback'
    ));

-- 3. Create index for new skills (performance)
CREATE INDEX IF NOT EXISTS idx_audit_logs_skill_new 
  ON audit_logs(routing_skill) 
  WHERE routing_skill IN ('risk_analyst', 'process_optimization', 'data_analysis');

-- 4. Update existing 'general' skills to 'fallback' (data migration)
UPDATE audit_logs SET routing_skill = 'fallback' WHERE routing_skill = 'general';
UPDATE feedback_reports SET skill = 'fallback' WHERE skill = 'general';

-- 5. Update renamed skills
UPDATE audit_logs SET routing_skill = 'business_writing' WHERE routing_skill = 'email';
UPDATE audit_logs SET routing_skill = 'creative_writing' WHERE routing_skill = 'creative';
UPDATE audit_logs SET routing_skill = 'prompt_optimizer' WHERE routing_skill = 'meta_prompting';
UPDATE audit_logs SET routing_skill = 'data_transformation' WHERE routing_skill = 'data_conversion';
UPDATE audit_logs SET routing_skill = 'editing' WHERE routing_skill = 'editing_critique';
UPDATE audit_logs SET routing_skill = 'document_analysis' WHERE routing_skill = 'document_qna';

UPDATE feedback_reports SET skill = 'business_writing' WHERE skill = 'email';
UPDATE feedback_reports SET skill = 'creative_writing' WHERE skill = 'creative';
UPDATE feedback_reports SET skill = 'prompt_optimizer' WHERE skill = 'meta_prompting';
UPDATE feedback_reports SET skill = 'data_transformation' WHERE skill = 'data_conversion';
UPDATE feedback_reports SET skill = 'editing' WHERE skill = 'editing_critique';
UPDATE feedback_reports SET skill = 'document_analysis' WHERE skill = 'document_qna';
```

---

## 6. Execution Plan (Phased Rollout)

### Phase 0: Skill Taxonomy Update (COMPLETED)
- [x] Update `skill-role-map.ts` to 20 skills
- [x] Update `SkillType` enum in `routing.types.ts`
- [x] Add 3 new prompts for new skills
- [x] Add 5 new few-shot entries
- [x] Update verification rules for new skills
- [x] Run migration `018_update_skill_taxonomy.sql`
- [x] Update tests

### Phase 1: Provider Abstraction (Week 1-2)
- [ ] Create `src/providers/llm-provider.interface.ts`
- [ ] Create `src/providers/bedrock-provider.ts`
- [ ] Migrate `routing-engine.service.ts` to use provider
- [ ] Migrate `sequential-reasoning.service.ts` to use provider
- [ ] Migrate `inference.service.ts` to use provider
- [ ] Add unit tests for provider layer
- [ ] Deploy to staging, validate no regressions

### Phase 2: Intent-First Router (Week 3-4)
- [ ] Create `src/services/intent-router.service.ts`
- [ ] Implement `applyDeterministicGates()`
- [ ] Implement `extractIntentAndConstraints()` (LLM call)
- [ ] Implement `resolveSkillFromIntent()` (deterministic)
- [ ] Implement `scoreComplexityFromIndicators()` (deterministic)
- [ ] Update `inference.routes.ts` to call new router
- [ ] Deprecate `unifiedClassifyAndScore()`
- [ ] A/B test new router vs old on staging
- [ ] Validate 0% skill hallucination over 1000 test prompts

### Phase 3: Unified ReAct Agent Graph (Week 5-7)
- [ ] Create `src/services/agent-graph.service.ts`
- [ ] Create `src/tools/tool-registry.ts`
- [ ] Implement REASON/ACT/OBSERVE loop
- [ ] Wrap existing services as tools:
  - [ ] `extract_document` → `document-extractor.service.ts`
  - [ ] `run_ocr` → two-stage OCR pipeline
  - [ ] `semantic_judge` → existing function
  - [ ] `query_memory` → `session-memory.service.ts`
- [ ] Implement new tools for 3 new skills:
  - [ ] `risk_assessment_framework`
  - [ ] `process_mapping`
  - [ ] `bottleneck_analyzer`
  - [ ] `statistical_analysis`
- [ ] Integrate `verifyOutput()` + `semanticJudge()` into OBSERVE node
- [ ] Update SSE events: `agent_thought`, `agent_action`, `agent_observation`
- [ ] Update `inference.routes.ts` to use AgentGraph
- [ ] Deprecate `sequential-reasoning.service.ts`
- [ ] Deprecate `subagent-orchestrator.service.ts`
- [ ] Load test: verify p95 latency ≤ current baseline

### Phase 4: Auto Self-Improvement (Week 8-10)
- [ ] Run migration `015_improvement_candidates.sql`
- [ ] Run migration `016_dynamic_system_configs.sql`
- [ ] Hook failure capture into `verifyOutput()`, `semanticJudge()`, feedback
- [ ] Create `src/services/meta-evaluator.service.ts`
- [ ] Deploy as GCP Cloud Run Job
- [ ] Configure GCP Cloud Scheduler (daily at 02:00 WIB)
- [ ] Add admin UI tab for proposal review
- [ ] Wire runtime injection in `inference.routes.ts` and `routing-engine.service.ts`
- [ ] Monitor first 7 days of auto-improvement proposals

### Phase 5: Observability (Week 11)
- [ ] Run migration `017_agent_trajectories.sql`
- [ ] Log full graph paths for debugging
- [ ] Add admin dashboard for trajectory inspection
- [ ] Create runbook for common failure patterns

### Phase 6: (Future) Database Migration to GCP Cloud SQL
- [ ] Provision GCP Cloud SQL in `asia-southeast2`
- [ ] Use Google Cloud DMS for replication from AWS RDS
- [ ] Cutover via environment variable update (zero code change)

---

## 7. Success Metrics

| Metric | Baseline (Current) | Target (Post-Refactor) |
|--------|-------------------|------------------------|
| Skill hallucination rate | ~2-5% (estimated) | **0%** |
| p95 latency (simple queries) | ~1.5s | **≤ 1.5s** (no regression) |
| p95 latency (complex queries) | ~8s | **≤ 8s** |
| Verification pass rate (first attempt) | ~75% | **≥ 90%** (via self-correction loop) |
| User-reported formatting issues | Baseline | **-50%** (via self-improvement) |
| Background job success rate | N/A | **≥ 95%** |
| Test coverage | 354 tests | **≥ 450 tests** (new graph + router) |
| Admin approval rate for AI proposals | N/A | **≥ 70%** |

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Agent loop exceeds 120s Cloud Run timeout | User sees timeout | Hard cap `MAX_AGENT_LOOPS = 6`; monitor per-loop duration; progressive synthesis every 3 loops |
| Self-improvement proposes bad prompts | System degradation | Human-in-the-loop approval for low-confidence proposals; auto-rollback if post-deploy metrics regress |
| Cross-cloud Bedrock latency spikes | p95 degradation | GCP Workload Identity + connection pooling; fallback to cached responses for routing tasks |
| Privacy leak via `improvement_candidates` | Compliance violation | Strict PII masking before insert; separate table with restricted IAM; quarterly audit |
| Breaking existing SSE frontend | UX regression | New events are additive; old events kept for 1 release cycle; frontend feature-flagged rollout |
| DB migration (future) causes downtime | User impact | Phased approach: code refactor first, DB migration later; zero-downtime via GCP DMS |
| New skills underperform | User dissatisfaction | Extensive few-shot examples; semantic judge for high-stakes skills; admin monitoring |

---

## 9. Decision Log

| Decision | Rationale |
|----------|-----------|
| ❌ Do not adopt LangGraph.js as dependency | Adds heavy abstraction; our existing services can be wrapped directly |
| ❌ Do not adopt Vercel AI SDK as dependency | Overkill for Bedrock-only; steal patterns, not the library |
| ❌ Do not import AutoGPT | Python platform, wrong abstraction level |
| ✅ Keep `skill-role-map.ts` as-is | Deterministic, battle-tested, zero hallucination |
| ✅ Keep PG advisory locks | Crash-safe, works across Cloud Run instances |
| ✅ Keep fail-closed PII masking | Indonesian PII compliance is non-negotiable |
| ✅ Code refactor before DB migration | Decouples risk; DB migration becomes trivial later |
| ✅ Unified ReAct loop over `auto`/`auto_v2` split | Simpler code, natural handling of simple+complex queries |
| ✅ Background self-improvement over inline repair | Protects latency; learns systemically |
| ✅ 20-skill taxonomy | Better semantic clarity, enterprise alignment |

---

## 10. Notes

1. Human approval for first 30 days, then auto-approve if ≥ 0.95 confidence.

2. **Trajectory retention: 30 days hot storage, then archive to cold storage (GCS) for 1 year.

3. **Meta-Evaluator schedule: Daily for first month, then weekly if proposal quality is high.

4. **Admin UI scope: Full UI with approve/reject, history, and metrics dashboard.

5. **Legacy sub-agent code: Feature flag for 1 release (2 weeks), then delete.

You are absolutely right, and I apologize for that oversight. The previous diagram merely reflected the **current** state of `beexexity` (from the `tech-reference.md`), completely ignoring the massive architectural shifts introduced in **Official Requirement Proposal v3.0**.

Let me correct this. Here is the **actual** User Experience and Background Process topology after implementing the v3.0 proposal, highlighting exactly what changes for the user and what changes under the hood.

---

### 1. The New User Experience (Frontend Perspective)

**What changes for the user?** 
Instead of a rigid, static plan (Thinking Mode) or a blind single-shot (Auto), the user now sees a **dynamic, transparent thought process** where the agent actively reasons, acts, and **self-corrects in real-time** before delivering the final answer.

```text
┌─────────────────────────────────────────────────────────────────────────────
│  USER SUBMITS: "Analyze the attached Q3 report, extract EBITDA, output JSON"│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  REAL-TIME REASONING BOX (SSE Stream - v3.0 ReAct Events)                   │
│                                                                             │
│  [Old UX]                           │  [New v3.0 UX]                        │
│  ───────────────────────────────────┼────────────────────────────────────── │
│  Routing: document_qna              │  🧠 Intent Extracted: Financial Data  │
│  Plan created: 4 steps              │  🎯 Skill Resolved: document_analysis │
│  Step 1/4: Running... ✓             │  🧠 Thought: "I need to extract text" │
│  Step 2/4: Running... ✓             │  🛠️ Action: Executing document_extract│
│  Step 3/4: Running... ✓             │  👁️ Observation: Text extracted.      │
│  Step 4/4: Running... ✓             │  🧠 Thought: "Now extract EBITDA"     │
│  Auto-repairing response...         │  ️ Action: Extracting metrics...     │
│                                     │  👁️ Observation: Format check failed! │
│                                     │   Self-Correcting: Removing markdown│
│                                     │  👁️ Observation: Verification passed! │
│                                     │  ✨ Synthesizing final JSON...        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  FINAL RESPONSE DELIVERY                                                    │
│  ─────────────────────────────────────────────────────────────────────────  │
│  [Clean, verified JSON array delivered. No markdown blocks. No hallucinations.]
│                                                                             │
│  [Action Buttons]                                                           │
│  ┌──────────  ┌──────────┐  ┌──────────────────────────────────────────┐   │
│  │  Copy    │  │ Download │  │  Feedback (Feeds the Self-Improvement    │   │
│  └──────────  └──────────┘  │  Engine for tomorrow's updates)          │   │
│                              └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 2. The New Background Process (Backend Architecture)

**What changes under the hood?**
The rigid `auto` / `auto_v2` split is gone. The fragile single-call LLM router is gone. The fire-and-forget `repairResponse` is gone. It is replaced by a **Deterministic Router**, a **Unified ReAct Graph**, and an **Async Self-Improvement Loop**.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: INTENT-FIRST ROUTING (Replaces unifiedClassifyAndScore)           │
│  ─────────────────────────────────────────────────────────────────────────  │
│  1. Deterministic Pre-Gating (Zero LLM cost)                                │
│     └─► Files only? → Hardcode 'document_analysis'                          │
│     └─► Code blocks? → Hardcode 'code'                                      │
│                                                                             │
│  2. LLM Intent Extraction (qwen3-32b)                                       │
│     └─► Extracts: { core_intent, required_data, constraints }               │
│     └─► ⚠️ NEVER asks "what skill is this?" (Prevents hallucination)        │
│                                                                             │
│  3. Deterministic Skill Resolution (TypeScript Code)                        │
│     └─► Maps intent to 1 of 20 skills using strict keyword lookup.          │
│     └─► Result: 0% skill hallucination.                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: DYNAMIC CONFIG INJECTION (v3.0 Self-Improvement Integration)      │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Before generating prompt, check GCP Cloud SQL:                             │
│  └─► "Are there approved AI-proposed few-shot examples for this skill?"     │
│  └─► "Are there approved global refinement rule overrides?"                 │
│  └─► Inject them into the context. (System learns from yesterday's errors)  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: UNIFIED REACT AGENT GRAPH (Replaces auto + auto_v2)               │
│  ─────────────────────────────────────────────────────────────────────────  │
│  State initialized in Cloud Run Memory (No DB writes during loop)           │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  LOOP (Max 6 iterations)                                              │  │
│  │                                                                       │  │
│  │  1. REASON Node (LLM): "What should I do next based on current state?"│  │
│  │     └─► Decide: Execute Tool OR Generate Final Response               │  │
│  │                                                                       │  │
│  │  2. ACT Node (Tools): Execute tool (extract, search, calculate).      │  │
│  │     └─► Apply Fail-Closed PII Masking to input/output.                │  │
│  │                                                                       │  │
│  │  3. OBSERVE Node (Guardrails):                                        │  │
│  │     ├─► Run deterministic verifyOutput()                              │  │
│  │     └─► Run semanticJudge() (if high-stakes skill)                    │  │
│  │                                                                       │  │
│  │  ┌─ CONDITIONAL EDGE ─────────────────────────────────────────────┐   │  │
│  │  │  If PASS → Exit Loop to Synthesis.                              │   │  │
│  │  │  If FAIL & retries < 2 → Inject error_feedback into State.      │   │  │
│  │  │       └─► LOOP BACK TO REASON (Agent self-corrects!)            │   │  │
│  │  ─────────────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  SYNTHESIS Node: Format final verified output.                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: ASYNC TELEMETRY & FAILURE CAPTURE (Post-Response)                 │
│  ─────────────────────────────────────────────────────────────────────────  │
│  1. Stream final output to user via SSE.                                    │
│  2. Fire-and-forget: Write telemetry to GCP Cloud SQL.                      │
│  3. IF Phase 3 OBSERVE failed (even if self-corrected):                     │
│     └─► PII-mask the input/output and insert into `improvement_candidates`  │
│     └─► Table. (Strictly metadata/masked text, no raw PII).                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼ (Nightly at 02:00 WIB)
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: META-EVALUATOR BACKGROUND JOB (GCP Cloud Run)                     │
│  ─────────────────────────────────────────────────────────────────────────  │
│  1. Query unevaluated clusters from `improvement_candidates`.               │
│  2. Call AWS Bedrock (qwen3-235b) to analyze root causes.                   │
│  3. Generate proposed fixes (New few-shot examples, new refinement rules).  │
│  4. Save to `dynamic_system_configs` table (Status: 'pending' or 'approved').│
│  5. Next day, Phase 2 injects these approved fixes into live inference.     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Summary of Changes: Old vs. New (v3.0)

To make the differences crystal clear, here is a direct comparison of what changed:

| Feature | Current State (Old) | Proposal v3.0 (New) | Impact on User / System |
| :--- | :--- | :--- | :--- |
| **Skill Routing** | Single LLM call guesses the skill. | **Intent-First:** LLM extracts intent $\rightarrow$ TypeScript code resolves skill. | **User:** 0% skill hallucination. **System:** Bulletproof routing. |
| **Execution Paths** | Two separate codebases: `auto` (single-shot) and `auto_v2` (rigid planner). | **Unified ReAct Graph:** Single codebase. Simple queries take 1 loop, complex take N loops. | **User:** Consistent behavior. **System:** 50% less code to maintain. |
| **Error Handling** | `repairResponse()` runs fire-and-forget *after* the user sees the broken output. | **Self-Correction Edge:** Verification happens *inside* the loop. Agent fixes errors *before* streaming. | **User:** Never sees broken formatting. **System:** Higher first-attempt pass rate. |
| **Learning** | Reactive. Admin reads feedback reports manually. | **Proactive Self-Improvement:** Background job analyzes failures and updates DB configs automatically. | **User:** System gets smarter every day without manual prompt engineering. |
| **Database Writes** | Synchronous writes during inference (audit, session, memory). | **Async Telemetry:** Active graph state stays in memory. DB writes happen post-response. | **User:** Lower latency, no DB timeouts during complex multi-step tasks. |

This is the true topology of the **Official Requirement Proposal v3.0**. It transforms `beexexity` from a static pipeline into a dynamic, self-healing, and self-improving agent.