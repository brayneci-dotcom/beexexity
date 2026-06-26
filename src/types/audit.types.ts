/**
 * Audit logging types.
 * @see Requirements 8.1, 8.2, 8.3, 8.4
 */

export interface AuditEntry {
  timestamp: string;          // ISO 8601
  userId: string;
  username: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  status: 'success' | 'failed';
  errorCategory?: string;
  durationMs: number;

  // New fields for multimodal uploads
  fileCount?: number;
  fileMimeTypes?: string[];
  totalFileSize?: number;
  isMultimodal?: boolean;

  // Routing metadata fields
  routingState?: 'auto' | 'manual';
  complexityScore?: number;
  routingReasonCode?: string;
  reasoningSummary?: string;
  executedModelId?: string;
  manualOverrideApplied?: boolean;
  routingFlags?: string[];

  // Session memory fields
  sessionId?: string;
  replayedMessageCount?: number;
  contextTruncated?: boolean;
  contextSummarized?: boolean;

  // Session continuity fields
  sessionState?: string;
  turnCount?: number;
}
