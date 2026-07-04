/**
 * Frontend cost display: cost calculation and session state management.
 * Displays costs in Indonesian Rupiah (IDR) by fetching a live conversion rate.
 * @see Requirements 9.2, 9.3, 9.4, 9.5, 9.7
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  PricingConfig,
  SessionCostState,
  RequestCost,
} from '../types/pricing.types.js';

// ─── IDR Conversion Rate (cached per session) ──────────────────────────────────

/**
 * Cached USD → IDR conversion rate.
 * Fetched once per application session from the budjet.org API.
 * Falls back to null if the API is unreachable (display will use USD).
 */
let cachedIdrRate: number | null = null;
let idrRateFetchPromise: Promise<number | null> | null = null;

/**
 * Fetches the USD → IDR conversion rate from the budjet.org API.
 * Called once per session; subsequent calls return the cached value.
 *
 * @returns The conversion rate (e.g., 15800.50) or null on failure.
 */
export async function fetchIdrRate(): Promise<number | null> {
  // Return cached value if already fetched
  if (cachedIdrRate !== null) {
    return cachedIdrRate;
  }

  // Deduplicate concurrent calls
  if (idrRateFetchPromise) {
    return idrRateFetchPromise;
  }

  idrRateFetchPromise = (async () => {
    try {
      const response = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
      if (!response.ok) {
        console.warn(`[cost-display] IDR rate API returned ${response.status}, falling back to USD`);
        return null;
      }
      const data = await response.json();
      const rate = data?.usd?.idr;
      if (typeof rate === 'number') {
        cachedIdrRate = rate;
        return cachedIdrRate;
      }
      console.warn('[cost-display] IDR rate API response missing usd.idr field');
      return null;
    } catch (error) {
      console.warn('[cost-display] Failed to fetch IDR rate, falling back to USD:', error);
      return null;
    } finally {
      idrRateFetchPromise = null;
    }
  })();

  return idrRateFetchPromise;
}

/**
 * Converts a USD cost amount to IDR display string.
 * If the IDR rate is not available, falls back to USD format.
 *
 * @param usdAmount - The cost in USD
 * @returns Formatted string like "Rp 15,250.75" or "$0.001234" (fallback)
 */
export function formatCostDisplay(usdAmount: number): string {
  if (cachedIdrRate !== null) {
    const idrAmount = usdAmount * cachedIdrRate;
    return `Rp ${idrAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  // Fallback: display in USD
  return `$${usdAmount.toFixed(6)}`;
}

/**
 * Returns whether IDR display is active (rate was successfully fetched).
 */
export function isIdrDisplayActive(): boolean {
  return cachedIdrRate !== null;
}

/**
 * Returns the cached IDR rate (for testing or external use).
 */
export function getCachedIdrRate(): number | null {
  return cachedIdrRate;
}

/**
 * Resets the cached rate (for testing purposes).
 */
export function resetIdrRateCache(): void {
  cachedIdrRate = null;
  idrRateFetchPromise = null;
}

// ─── Pricing Config Loading ────────────────────────────────────────────────────

/**
 * Loads and parses the pricing configuration JSON.
 * Returns null if the file is unavailable or cannot be parsed.
 * @see Requirement 9.1, 9.7
 */
export function loadPricingConfig(configPath?: string): PricingConfig | null {
  try {
    const defaultPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      'pricing-config.json'
    );
    const filePath = configPath ?? defaultPath;
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    // Basic validation
    if (!parsed.models || typeof parsed.models !== 'object') {
      return null;
    }
    if (!parsed.currency || !parsed.lastUpdated) {
      return null;
    }

    return parsed as PricingConfig;
  } catch {
    return null;
  }
}

/**
 * Calculates cost for a single inference request.
 * Formula: cost = (inputTokens × inputRate + outputTokens × outputRate) / 1_000_000
 *
 * Returns null if the model is not found in the pricing config.
 * @see Requirement 9.3
 */
export function calculateRequestCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  config: PricingConfig | null
): number | null {
  if (!config) {
    return null;
  }

  const modelPricing = config.models[modelId];
  if (!modelPricing) {
    return null;
  }

  const cost =
    (inputTokens * modelPricing.inputPricePer1MTokens +
      outputTokens * modelPricing.outputPricePer1MTokens) /
    1_000_000;

  return cost;
}

/**
 * Tracks costs across multiple requests in a session.
 * On model switch, past request costs are NOT recalculated — each request's cost
 * is locked at the rate that was active when that request was made.
 * @see Requirements 9.4, 9.5
 */
export class SessionCostTracker {
  private requests: RequestCost[] = [];
  private sessionTotal: number = 0;
  private config: PricingConfig | null;

  constructor(config: PricingConfig | null) {
    this.config = config;
  }

  /**
   * Records a completed request and adds its cost to the session total.
   * If pricing config is unavailable or the model is not found, the request
   * is still tracked (with cost = 0) for token counting purposes.
   */
  addRequest(modelId: string, inputTokens: number, outputTokens: number): RequestCost {
    const cost = calculateRequestCost(modelId, inputTokens, outputTokens, this.config);

    const requestCost: RequestCost = {
      modelId,
      inputTokens,
      outputTokens,
      cost: cost ?? 0,
    };

    this.requests.push(requestCost);
    this.sessionTotal += requestCost.cost;

    return requestCost;
  }

  /**
   * Returns the current session state snapshot.
   */
  getState(): SessionCostState {
    return {
      requests: [...this.requests],
      sessionTotal: this.sessionTotal,
    };
  }

  /**
   * Returns the running session total in USD.
   */
  getSessionTotal(): number {
    return this.sessionTotal;
  }

  /**
   * Returns all recorded request costs.
   */
  getRequests(): RequestCost[] {
    return [...this.requests];
  }

  /**
   * Returns whether pricing information is available.
   * When false, token counts are tracked but costs show as 0.
   */
  hasPricingAvailable(): boolean {
    return this.config !== null;
  }

  /**
   * Returns whether a specific model has pricing information.
   */
  hasModelPricing(modelId: string): boolean {
    if (!this.config) return false;
    return modelId in this.config.models;
  }

  /**
   * Resets the session state (e.g., on logout or new session).
   */
  reset(): void {
    this.requests = [];
    this.sessionTotal = 0;
  }
}
