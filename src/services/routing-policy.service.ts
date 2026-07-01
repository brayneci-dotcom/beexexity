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
 * Score 1     → qwen.qwen3-32b-v1:0 (fast, simple questions only)
 * Score 2-5   → qwen.qwen3-235b-a22b-2507-v1:0 (stronger reasoning)
 */
export function applyTextPolicy(score: number): PolicyResult {
  if (score <= 1) {
    return { modelId: 'qwen.qwen3-32b-v1:0', reasonCode: 'complexity-1' };
  }

  // Score 2-5 → higher performance model
  return { modelId: 'qwen.qwen3-235b-a22b-2507-v1:0', reasonCode: `complexity-${score}` };
}

/**
 * Applies vision-aware routing when images are present.
 * Selects from vision-capable models only:
 *   - openai.gpt-oss-120b-1:0
 *   - qwen.qwen3-235b-a22b-2507-v1:0
 *   - qwen.qwen3-32b-v1:0
 *
 * Complexity bands within vision models:
 *   Score 1     → qwen.qwen3-32b-v1:0 (lightweight, simple questions)
 *   Score 2-3   → openai.gpt-oss-120b-1:0 (stronger vision, moderate complexity)
 *   Score 4-5   → qwen.qwen3-235b-a22b-2507-v1:0 (advanced vision + reasoning)
 */
export function applyVisionPolicy(score: number): PolicyResult {
  if (score >= 4) {
    return { modelId: 'qwen.qwen3-235b-a22b-2507-v1:0', reasonCode: `vision-complexity-${score}` };
  }

  if (score >= 2) {
    return { modelId: 'openai.gpt-oss-120b-1:0', reasonCode: `vision-complexity-${score}` };
  }

  // Score 1 → lightweight model
  return { modelId: 'qwen.qwen3-32b-v1:0', reasonCode: 'vision-complexity-1' };
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
