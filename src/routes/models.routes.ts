import { Router, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { forcePasswordResetMiddleware } from '../middleware/password-reset.middleware.js';
import { ALLOWED_MODELS, DEFAULT_MODEL } from '../types/inference.types.js';
import { MODEL_CAPABILITIES, ModelCapability } from '../config/model-capabilities.js';
import { query } from '../config/database.js';

/**
 * Models route — GET /api/v1/models
 * Returns the list of available models with display names, pricing info,
 * and marks the default model. Filters out private models the user cannot access.
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

/**
 * Check if a model has access rows (i.e., is private).
 * If yes, check if the current user is whitelisted.
 */
async function isModelAllowedForUser(modelId: string, userId: string): Promise<boolean> {
  try {
    const { rows } = await query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM user_model_access WHERE model_id = $1) AS exists',
      [modelId],
    );
    if (!rows[0]?.exists) return true; // public model

    const { rows: access } = await query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM user_model_access WHERE user_id = $1 AND model_id = $2) AS exists',
      [userId, modelId],
    );
    return access[0]?.exists ?? false;
  } catch {
    return false; // fail closed
  }
}

const router = Router();

router.get('/', authMiddleware, forcePasswordResetMiddleware, async (req: Request, res: Response) => {
  const pricingConfig = loadPricingConfig();

  const modelInfos: ModelInfo[] = ALLOWED_MODELS.map((modelId) => {
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

  // Filter out private models the user cannot access
  const allowed = await Promise.all(
    modelInfos.map(async (m) => {
      const ok = await isModelAllowedForUser(m.modelId, req.user!.sub);
      return ok ? m : null;
    }),
  );

  res.json({
    models: allowed.filter(Boolean),
    defaultModel: DEFAULT_MODEL,
    currency: pricingConfig?.currency ?? 'USD',
  });
});

export default router;
