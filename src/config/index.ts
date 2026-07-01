import 'dotenv/config';

/**
 * Application configuration.
 * All AWS resources are locked to ap-southeast-3 (Jakarta) for data residency compliance.
 */

export const config = {
  aws: {
    region: 'ap-southeast-3',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: parseInt(process.env.JWT_EXPIRES_IN || '3600', 10),
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'bedrock_gateway',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  },
  routing: {
    longContextThreshold: parseInt(
      process.env.ROUTING_LONG_CONTEXT_THRESHOLD || '8000', 10
    ),
    scoringTimeoutMs: parseInt(
      process.env.ROUTING_SCORING_TIMEOUT_MS || '5000', 10
    ),
    refinementTimeoutMs: parseInt(
      process.env.ROUTING_REFINEMENT_TIMEOUT_MS || '8000', 10
    ),
    defaultFallbackScore: parseInt(
      process.env.ROUTING_DEFAULT_FALLBACK_SCORE || '2', 10
    ),
    metadataEnabled: process.env.ROUTING_METADATA_ENABLED !== 'false',
    transparencyEnabled: process.env.ROUTING_TRANSPARENCY_ENABLED === 'true',
    scoringModelId: 'qwen.qwen3-32b-v1:0',
  },
  auth: {
    minPasswordLength: parseInt(process.env.MIN_PASSWORD_LENGTH || '8', 10),
    resetTokenExpiresIn: 300, // 5 minutes for password reset token
  },
  session: {
    expiryHours: parseInt(process.env.SESSION_EXPIRY_HOURS || '24', 10),
    tokenBudget: parseInt(process.env.SESSION_TOKEN_BUDGET || '200000', 10),
    safetyMargin: parseInt(process.env.SESSION_SAFETY_MARGIN || '20000', 10),
    summaryThreshold: parseInt(process.env.SESSION_SUMMARY_THRESHOLD || '40', 10),
    charsPerToken: parseInt(process.env.SESSION_CHARS_PER_TOKEN || '4', 10),
    routingContextMaxChars: parseInt(process.env.SESSION_ROUTING_CONTEXT_MAX_CHARS || '500', 10),
    routingContextMaxTurns: parseInt(process.env.SESSION_ROUTING_CONTEXT_MAX_TURNS || '2', 10),
    maxHistoryTurns: parseInt(process.env.MAX_HISTORY_TURNS || '10', 10),
    maxContextCharacters: parseInt(process.env.MAX_CONTEXT_CHARACTERS || '120000', 10),
    listPageSize: parseInt(process.env.SESSION_LIST_PAGE_SIZE || '50', 10),
  },
} as const;
