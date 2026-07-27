import { query } from '../config/database.js';

/**
 * Application configuration service.
 * Reads/writes key-value pairs in the app_config table.
 * In-memory cache for hot-path reads; cache invalidated on write.
 */
class ConfigService {
  private cache = new Map<string, unknown>();

  /**
   * Check if passthrough mode is globally enabled.
   * Cached in-memory after first read; refresh on write.
   */
  async getPassthroughMode(): Promise<boolean> {
    const cached = this.cache.get('passthrough_mode');
    if (cached !== undefined) return cached as boolean;

    try {
      const result = await query<{ value: string }>(
        "SELECT value FROM app_config WHERE key = 'passthrough_mode'",
      );
      const val = result.rows[0]?.value;
      const enabled = val ? JSON.parse(val) === true : false;
      this.cache.set('passthrough_mode', enabled);
      return enabled;
    } catch {
      // DB not ready or table doesn't exist yet — safe default
      return false;
    }
  }

  /**
   * Set passthrough mode globally. Invalidates cache.
   */
  async setPassthroughMode(enabled: boolean): Promise<void> {
    try {
      await query(
        `INSERT INTO app_config (key, value) VALUES ('passthrough_mode', $1::text::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = $1::text::jsonb`,
        [JSON.stringify(enabled)],
      );
      this.cache.set('passthrough_mode', enabled);
    } catch (error) {
      console.error('[config] Failed to set passthrough_mode:', (error as Error).message);
      throw error;
    }
  }

  /** Invalidate entire cache (for future use if more configs added). */
  invalidateCache(): void {
    this.cache.clear();
  }
}

export const configService = new ConfigService();
