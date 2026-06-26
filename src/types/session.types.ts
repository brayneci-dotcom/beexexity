/**
 * Session and context assembly types for conversation memory.
 * @see Requirements 1.3, 2.4, 3.1, 3.6
 */

import type { InferenceResult } from './inference.types.js';

export interface Session {
  id: string;               // UUID
  userId: string;           // FK → users.id
  status: 'active' | 'degraded' | 'inactive' | 'expired';
  turnCount: number;        // Incremented on every successful turn
  createdAt: string;        // ISO 8601
  updatedAt: string;
  lastActivityAt: string;
  expiresAt: string;
}

export interface StorageFlags {
  piiMasked: boolean;
  assistantSanitized?: boolean;
  partiallyPersisted?: boolean;
}

export interface StoredMessage {
  id: string;               // UUID
  sessionId: string;
  role: 'user' | 'assistant';
  sanitizedContent: string;
  createdAt: string;        // ISO 8601
  storageFlags: StorageFlags;
}

export interface BedrockMessage {
  role: 'user' | 'assistant';
  content: Array<{ text: string }>;
}

export interface ContextAssemblyConfig {
  tokenBudget: number;          // Max tokens for history (default 200,000)
  safetyMargin: number;         // Reserved for current prompt + system + response (default 20,000)
  summaryThreshold: number;     // Messages before summary triggers (default 40)
  charsPerToken: number;        // Approximation ratio (default 4)
}

export interface AssembledContext {
  messages: BedrockMessage[];   // Ordered user/assistant pairs for ConverseStream
  totalEstimatedTokens: number;
  truncated: boolean;
  truncatedCount: number;       // Number of messages dropped
  summarized: boolean;
  originalMessageCount: number;
}

export interface ConversationInferenceRequest {
  messages: BedrockMessage[];   // Full conversation history + current prompt
  modelId: string;
  userId: string;
  inferenceConfig?: {
    maxTokens?: number;
    temperature?: number;
    topP?: number;
  };
}

export interface ConversationInferenceResult extends InferenceResult {
  assistantText: string;  // Full accumulated assistant response for storage
}
