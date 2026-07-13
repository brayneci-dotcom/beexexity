/**
 * Inference service types and model constants.
 * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3
 */

import type { ContentBlock } from './upload.types.js';

export interface InferenceRequest {
  maskedPrompt: string;
  modelId: string;
  userId: string;
  inferenceConfig?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  };
  contentBlocks?: ContentBlock[];
}

export interface MultimodalInferenceRequest {
  contentBlocks: ContentBlock[];
  modelId: string;
  userId: string;
  inferenceConfig?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  };
}

export interface InferenceResult {
  status: 'success' | 'failed';
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  errorCategory?: 'throttling' | 'timeout' | 'model_error' | 'unknown';
}

export const ALLOWED_MODELS = [
  'amazon.nova-lite-v1:0',
  'anthropic.claude-sonnet-5',
  'openai.gpt-oss-120b-1:0',
  'qwen.qwen3-235b-a22b-2507-v1:0',
  'qwen.qwen3-32b-v1:0',
  'zai.glm-5',
] as const;

export type AllowedModelId = typeof ALLOWED_MODELS[number];

export const DEFAULT_MODEL: AllowedModelId = 'qwen.qwen3-32b-v1:0';

export interface ModalityFlags {
  textOnly: boolean;
  documentText: boolean;
  image: boolean;
  mixed: boolean;
}

export interface RoutingMetadataEvent {
  refinedPrompt?: string;
  complexityScore?: number;
  scoreBand?: string;
  routingState: 'auto' | 'manual';
  executedModelId: string;
  routingReasonCode: string;
  reasoningSummary: string;
  modalityFlags?: ModalityFlags;
  manualOverrideApplied: boolean;
  skill?: string;  // classified request type from hybrid router
  contract?: Record<string, unknown> | null;  // structured prompt contract

  // Confidence & flags from routing decision
  confidence?: number;
  flags?: string[];

  // Routing engine timing (ms per step)
  routingDurationMs?: number;
  classificationDurationMs?: number;
  refinementDurationMs?: number;
  scoringDurationMs?: number;

  // Prompt info
  originalPromptLength?: number;
  promptLengthAfterRefinement?: number;

  // Conversation context
  conversationContext?: string;  // routing_payload sent to routing engine
  historyMessageCount?: number;
  contextTruncated?: boolean;

  // Session memory state
  memorySummary?: string;
  memoryVersion?: number;
  /** Structured key-value facts extracted from conversation */
  memoryFacts?: Record<string, string>;

  // Two-stage OCR info (multipart only)
  ocrExecuted?: boolean;
  ocrModel?: string;
  enhanceModel?: string;

  // Raw LLM call data for debugging (routeRequest internals)
  _classificationRaw?: string;   // Raw response from unifiedClassifyAndScore
  _classificationPrompt?: string; // Prompt sent to classifier
  _refinementRaw?: string;        // Raw response from refinePrompt
  _refinementPrompt?: string;     // Prompt sent to refiner
}

// ── Sequential Reasoning ───────────────────────────────────────────────

export interface SequentialStep {
  order: number;          // 1-indexed
  name: string;
  description: string;
  systemPrompt: string;   // Full step prompt for Bedrock
  modelId: string;
}

export interface SequentialPlan {
  steps: SequentialStep[];
  reasoning: string;       // Why this plan was chosen
}

export interface StepResult {
  order: number;
  status: 'success' | 'failed' | 'skipped';
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  retryCount: number;
  errorMessage?: string;
}

export interface SequentialOrchestrationMeta {
  plan: { steps: { name: string; description: string }[] };
  stepResults: StepResult[];
  synthesisStatus: 'success' | 'partial' | 'failed';
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
}

// SSE event payloads for orchestration
export interface OrchestrationPlanEvent {
  steps: { order: number; name: string; description: string }[];
  reasoning: string;
}

export interface OrchestrationStatusEvent {
  step: number;
  total: number;
  name: string;
  description: string;
  status: 'running' | 'completed' | 'failed';
  durationMs?: number;
}

export interface OrchestrationStepEvent {
  step: number;
  content: string;        // Streaming token fragment
}

export interface OrchestrationInterimEvent {
  step: number;
  total: number;
  insight: string;        // Partial synthesis of findings so far
}

export interface OrchestrationErrorEvent {
  step: number;
  name: string;
  reason: string;
}
