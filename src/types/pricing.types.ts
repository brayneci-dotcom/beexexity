/**
 * Frontend cost display and pricing types.
 * @see Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

export interface PricingConfig {
  models: Record<string, ModelPricing>;
  currency: 'USD';
  lastUpdated: string;
}

export interface ModelPricing {
  modelId: string;
  displayName: string;
  inputPricePer1MTokens: number;   // USD
  outputPricePer1MTokens: number;  // USD
}

export interface SessionCostState {
  requests: RequestCost[];
  sessionTotal: number;           // USD
  currentRequest?: {
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
}

export interface RequestCost {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;                   // USD, calculated at THIS model's rate
}
