/**
 * Model Capability Registry
 *
 * Static mapping of each available model to its supported content types.
 * Vision models accept image content blocks; text-only models accept only text.
 */

export type ModelCapability = 'text-only' | 'text-and-image';

export interface ModelCapabilityEntry {
  modelId: string;
  capability: ModelCapability;
  displayName: string;
  /** Maximum output tokens the model can generate in one response. */
  maxOutputTokens: number;
}

export const MODEL_CAPABILITIES: Record<string, ModelCapabilityEntry> = {
  'amazon.nova-lite-v1:0': {
    modelId: 'amazon.nova-lite-v1:0',
    capability: 'text-and-image',
    displayName: 'Amazon Nova Lite',
    maxOutputTokens: 5120,
  },
  'openai.gpt-oss-120b-1:0': {
    modelId: 'openai.gpt-oss-120b-1:0',
    capability: 'text-and-image',
    displayName: 'OpenAI GPT OSS 120B',
    maxOutputTokens: 16384,
  },
  'qwen.qwen3-235b-a22b-2507-v1:0': {
    modelId: 'qwen.qwen3-235b-a22b-2507-v1:0',
    capability: 'text-and-image',
    displayName: 'Qwen3 235B A22B',
    maxOutputTokens: 8192,
  },
  'qwen.qwen3-32b-v1:0': {
    modelId: 'qwen.qwen3-32b-v1:0',
    capability: 'text-and-image',
    displayName: 'Qwen3 32B',
    maxOutputTokens: 8192,
  },
  'anthropic.claude-sonnet-5': {
    modelId: 'anthropic.claude-sonnet-5',
    capability: 'text-only',
    displayName: 'Claude Sonnet 5',
    maxOutputTokens: 8192,
  },
  'zai.glm-5': {
    modelId: 'zai.glm-5',
    capability: 'text-only',
    displayName: 'GLM-5',
    maxOutputTokens: 8192,
  },
};

/**
 * Returns the maximum output tokens for a given model ID.
 * Falls back to 4096 for unknown models.
 */
export function getModelMaxOutputTokens(modelId: string): number {
  return MODEL_CAPABILITIES[modelId]?.maxOutputTokens ?? 4096;
}

/**
 * Check if a model supports image content blocks.
 */
export function supportsImages(modelId: string): boolean {
  const entry = MODEL_CAPABILITIES[modelId];
  return entry?.capability === 'text-and-image';
}

/**
 * Get list of vision-capable model IDs.
 */
export function getVisionModels(): string[] {
  return Object.entries(MODEL_CAPABILITIES)
    .filter(([, entry]) => entry.capability === 'text-and-image')
    .map(([modelId]) => modelId);
}
