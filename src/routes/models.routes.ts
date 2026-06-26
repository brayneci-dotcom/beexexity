import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { forcePasswordResetMiddleware } from '../middleware/password-reset.middleware.js';
import { ALLOWED_MODELS, DEFAULT_MODEL } from '../types/inference.types.js';
import { MODEL_CAPABILITIES, ModelCapability } from '../config/model-capabilities.js';

/**
 * Models route — GET /api/v1/models
 * Returns the list of available models with display names, pricing info,
 * and marks the default model.
 *
 * @see Requirements 5.1, 5.2
 */

export interface ModelInfo {
  modelId: string;
  displayName: string;
  isDefault: boolean;
  capability: ModelCapability;
  pricing?: {
    inputPricePer1MTokens: number;
    outputPricePer1MTokens: number;
  };
}

interface PricingConfigEntry {
  displayName: string;
  inputPricePer1MTokens: number;
  outputPricePer1MTokens: number;
}

interface PricingConfigFile {
  currency: string;
  lastUpdated: string;
  models: Record<string, PricingConfigEntry>;
}

/**
 * Load pricing config from the bundled JSON file.
 * Returns null if the file cannot be read (graceful degradation).
 */
function loadPricingConfig(): PricingConfigFile | null {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const configPath = join(__dirname, '..', 'frontend', 'pricing-config.json');
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as PricingConfigFile;
  } catch {
    return null;
  }
}

const router = Router();

router.get('/', authMiddleware, forcePasswordResetMiddleware, (_req: Request, res: Response) => {
  const pricingConfig = loadPricingConfig();

  const models: ModelInfo[] = ALLOWED_MODELS.map((modelId) => {
    const pricingEntry = pricingConfig?.models[modelId];

    const modelInfo: ModelInfo = {
      modelId,
      displayName: pricingEntry?.displayName ?? modelId,
      isDefault: modelId === DEFAULT_MODEL,
      capability: MODEL_CAPABILITIES[modelId]?.capability ?? 'text-only',
    };

    if (pricingEntry) {
      modelInfo.pricing = {
        inputPricePer1MTokens: pricingEntry.inputPricePer1MTokens,
        outputPricePer1MTokens: pricingEntry.outputPricePer1MTokens,
      };
    }

    return modelInfo;
  });

  res.json({
    models,
    defaultModel: DEFAULT_MODEL,
    currency: pricingConfig?.currency ?? 'USD',
  });
});

export default router;
