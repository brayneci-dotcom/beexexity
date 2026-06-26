/**
 * Routing engine types and interfaces.
 * @see Requirements 4.1, 5.1, 5.4, 6.1, 8.4, 10.1
 */

// Re-export ModalityFlags from the canonical definition in inference.types.ts
export type { ModalityFlags } from './inference.types.js';

import type { ModalityFlags } from './inference.types.js';

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
  scoreBand: 'direct-answer' | 'stronger-reasoning' | 'advanced-reasoning';
  confidence: number;               // 0.0-1.0
  refinedPrompt: string;            // The refined or original prompt
  routingReasonCode: string;        // e.g. 'complexity-band-1-3', 'long-context', 'vision-required'
  reasoningSummary: string;         // Human-readable summary
  modalityFlags: ModalityFlags;
  manualOverrideApplied: boolean;
  flags: string[];                  // e.g. ['refinement-failed']
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
