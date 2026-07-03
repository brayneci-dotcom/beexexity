/**
 * Routing engine types and interfaces.
 * @see Requirements 4.1, 5.1, 5.4, 6.1, 8.4, 10.1
 */

// Re-export ModalityFlags from the canonical definition in inference.types.ts
export type { ModalityFlags } from './inference.types.js';

import type { ModalityFlags } from './inference.types.js';

/**
 * Skill type for the hybrid router — classifies user requests into one of
 * 17 categories across 5 groups to select a skill-specific refinement prompt.
 */
export type SkillType =
  // Generation
  | 'email' | 'creative' | 'brainstorming' | 'meta_prompting'
  // Transformation
  | 'summarization' | 'translation' | 'data_conversion' | 'editing_critique'
  // Interaction
  | 'roleplay' | 'logic_math' | 'planning_strategy' | 'document_qna'
  // Enterprise
  | 'requirement_generation' | 'compliance_pre_assessment'
  // Engineering
  | 'code' | 'log_troubleshooting' | 'general';

/** Ordered list of all skill types for regex extraction. */
export const ALL_SKILLS: SkillType[] = [
  'email', 'creative', 'brainstorming', 'meta_prompting',
  'summarization', 'translation', 'data_conversion', 'editing_critique',
  'roleplay', 'logic_math', 'planning_strategy', 'document_qna',
  'requirement_generation', 'compliance_pre_assessment',
  'code', 'log_troubleshooting', 'general',
];

/**
 * Structured prompt contract produced by the refinement step.
 * Preserves structure that flowing text loses — enables verification.
 */
export interface PromptContract {
  role: string;
  context: string;
  task: string;
  intent: string;
  /** What is unclear or missing in the user's request. */
  ambiguities: string[];
  /** Whether the system should ask the user for clarification before proceeding. */
  clarificationNeeded: boolean;
  /** Optional format constraints inferred from the request. */
  format?: {
    type: string;              // "email", "code", "report", "plain-text"
    mustInclude?: string[];    // required sections
    mustAvoid?: string[];      // prohibited content
  };
  /** Explicit constraints from the user. */
  constraints?: string[];
}

/**
 * Input to the routing engine for determining model selection.
 * All text fields should already be PII-masked before reaching this interface.
 */
export interface RoutingInput {
  originalPrompt: string;           // Already PII-masked
  maskedDocumentText?: string;      // Extracted + masked doc text
  hasImages: boolean;
  imageModelRequired: boolean;
  routingState: 'auto' | 'manual';
  manualModelId?: string;           // Set when routingState = 'manual'
  userId: string;
  conversationContext?: string;     // Compact recent-turns text for scoring (prior user messages, capped)
}

/**
 * The complete routing decision produced by the routing engine.
 * Contains model selection, scoring, and transparency metadata.
 */
export interface RoutingDecision {
  executedModelId: string;
  routingState: 'auto' | 'manual';
  complexityScore: number;          // 1-5
  scoreBand: 'direct-answer' | 'moderate-reasoning' | 'advanced-reasoning';
  confidence: number;               // 0.0-1.0
  refinedPrompt: string;            // The refined or original prompt
  routingReasonCode: string;        // e.g. 'complexity-band-1-3', 'long-context', 'vision-required'
  reasoningSummary: string;         // Human-readable summary
  modalityFlags: ModalityFlags;
  manualOverrideApplied: boolean;
  flags: string[];                  // e.g. ['refinement-failed']
  skill: SkillType;                 // classified request type for transparency
  contract: PromptContract | null;  // structured contract from refinement
}

/** Result of a deterministic verification check. */
export interface VerificationViolation {
  field: string;       // "format.subject", "constraints.wordCount"
  issue: string;       // "missing subject line"
  severity: 'error' | 'warn';
}

export interface VerificationResult {
  passed: boolean;
  violations: VerificationViolation[];
  checks: { name: string; passed: boolean; detail: string }[];
}

/**
 * Configuration for the routing engine's operational parameters.
 */
export interface RoutingEngineConfig {
  longContextThreshold: number;     // Token count threshold (default: 8000)
  scoringTimeoutMs: number;         // Timeout for scoring call (default: 5000)
  refinementTimeoutMs: number;      // Timeout for refinement call (default: 8000)
  defaultFallbackScore: number;     // Default on scoring failure (default: 2)
  routingMetadataEnabled: boolean;  // Whether to emit routing SSE event
}

/**
 * Input to the routing policy resolver for model selection.
 */
export interface PolicyInput {
  complexityScore: number;
  hasImages: boolean;
  isLongContext: boolean;
  routingState: 'auto' | 'manual';
  manualModelId?: string;
}

/**
 * Result from the routing policy indicating model selection and reason.
 */
export interface PolicyResult {
  modelId: string;
  reasonCode: string;
}
