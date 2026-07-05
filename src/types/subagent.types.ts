/**
 * Sub-Agent Orchestration types.
 * @see docs/feat-sub-agent/design.md
 */

/**
 * Specification for one sub-agent — output of the Planner LLM.
 * Planner outputs the BASE instruction; orchestrator injects document context
 * wrapped in XML tags (<document_context>, <conversation_context>) later.
 */
export interface SubAgentSpec {
  agentId: string;
  /** Sub-skill focus for this agent (e.g. 'data_extraction', 'legal_analysis'). */
  skill: string;
  /** Base instruction from planner. Orchestrator appends XML-tagged context. */
  prompt: string;
  /** Optional model override. Defaults to qwen3-235b. Planner can pick 32b or 120b for simple tasks. */
  targetModel?: string;
  /** Reserved for future dependency graph. Always empty in v1 (all parallel). */
  dependencies: string[];
}

/** Result from executing one sub-agent. */
export interface SubAgentResult {
  agentId: string;
  status: 'success' | 'failed' | 'timeout';
  /** PII-masked output text. */
  text: string;
  /** Why the agent failed — passed to synthesizer for context-aware merging. */
  errorMessage?: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

/** Structured output from the Planner LLM. */
export interface SubAgentPlan {
  specs: SubAgentSpec[];
  reasoning: string;
}

/** Metadata captured during orchestration — stored in audit log. */
export interface OrchestrationMeta {
  specs: SubAgentSpec[];
  results: SubAgentResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
  plannerDurationMs: number;
  executeDurationMs: number;
  synthesisDurationMs: number;
  synthesizeUsed: boolean;
  /** True if any single agent output exceeded its budget share and was summarized. */
  summarizeTriggered: boolean;
}
