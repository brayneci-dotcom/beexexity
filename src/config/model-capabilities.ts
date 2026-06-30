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
}

export const MODEL_CAPABILITIES: Record<string, ModelCapabilityEntry> = {
  'amazon.nova-lite-v1:0': {
    modelId: 'amazon.nova-lite-v1:0',
    capability: 'text-and-image',
    displayName: 'Amazon Nova Lite',
  },
  'openai.gpt-oss-120b-1:0': {
    modelId: 'openai.gpt-oss-120b-1:0',
    capability: 'text-and-image',
    displayName: 'OpenAI GPT OSS 120B',
  },
  'qwen.qwen3-235b-a22b-2507-v1:0': {
    modelId: 'qwen.qwen3-235b-a22b-2507-v1:0',
    capability: 'text-and-image',
    displayName: 'Qwen3 235B A22B',
  },
  'qwen.qwen3-32b-v1:0': {
    modelId: 'qwen.qwen3-32b-v1:0',
    capability: 'text-and-image',
    displayName: 'Qwen3 32B',
  },
};

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
