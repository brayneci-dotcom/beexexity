/**
 * Routing Policy Service
 *
 * Implements policy-based model selection for the routing engine.
 * Priority order: manual state → long-context → vision → text policy.
 *
 * DeepSeek V3 (deepseek.v3-v1:0) is NEVER returned by any policy function.
 *
 * @see Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 9.1, 9.3
 */

import type { PolicyInput, PolicyResult } from '../types/routing.types.js';

/**
 * Applies text-only routing policy based on complexity score.
 * Qwen3 32B is reserved for prompt refinement + complexity scoring only.
 * All inference is routed to models with 128K+ context windows.
 *
 * Score 1-5 → qwen.qwen3-235b-a22b-2507-v1:0 (256K context, 8K output)
 */
export function applyTextPolicy(score: number): PolicyResult {
  return { modelId: 'qwen.qwen3-235b-a22b-2507-v1:0', reasonCode: `complexity-${score}` };
}

/**
 * Applies vision-aware routing when images are present.
 * Qwen3 32B is not used for inference — refinement/scoring only.
 *
 * Complexity bands:
 *   Score 1-3   → openai.gpt-oss-120b-1:0 (128K context, 16K output, strong vision)
 *   Score 4-5   → qwen.qwen3-235b-a22b-2507-v1:0 (256K context, 8K output, advanced)
 */
export function applyVisionPolicy(score: number): PolicyResult {
  if (score >= 4) {
    return { modelId: 'qwen.qwen3-235b-a22b-2507-v1:0', reasonCode: `vision-complexity-${score}` };
  }

  // Score 1-3 → mid-tier vision model
  return { modelId: 'openai.gpt-oss-120b-1:0', reasonCode: `vision-complexity-${score}` };
}

/**
 * Applies long-context override when input exceeds threshold.
 * Prefers qwen.qwen3-235b-a22b-2507-v1:0 for its strong context handling.
 */
export function applyLongContextPolicy(): PolicyResult {
  return { modelId: 'qwen.qwen3-235b-a22b-2507-v1:0', reasonCode: 'long-context' };
}

/**
 * Top-level policy dispatcher.
 * Priority order: manual state → long-context → vision → text policy.
 */
export function resolvePolicy(input: PolicyInput): PolicyResult {
  // 1. Manual state: honor the user's explicit model selection
  if (input.routingState === 'manual' && input.manualModelId) {
    return { modelId: input.manualModelId, reasonCode: 'manual-override' };
  }

  // 2. Long-context override (only for auto state without images)
  if (input.isLongContext && !input.hasImages) {
    return applyLongContextPolicy();
  }

  // 3. Vision policy when images are present
  if (input.hasImages) {
    return applyVisionPolicy(input.complexityScore);
  }

  // 4. Default: text-only policy based on complexity score
  return applyTextPolicy(input.complexityScore);
}
