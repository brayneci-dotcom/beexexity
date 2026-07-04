/**
 * Session Memory Service
 *
 * Three-tier session memory for conversation continuity:
 *   Tier 1 — Raw recent turns (kept verbatim via existing sliding window)
 *   Tier 2 — Rolling summary for older turns beyond the raw window
 *   Tier 3 — Structured facts extracted from each turn
 *
 * When the context window budget is exceeded, the oldest messages are evicted
 * and summarized via Bedrock Converse (qwen3-32b, non-streaming). The summary
 * is stored on the `sessions` table and injected into the inference prompt
 * on subsequent turns. Facts (key decisions, preferences, constraints) are
 * extracted after every successful inference turn.
 *
 * @see Requirements 3.x, 4.x
 */

import { query } from '../config/database.js';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { config } from '../config/index.js';
import type { StoredMessage } from '../types/session.types.js';

// ─── Types ───────────────────────────────────────────────────────────────────────

export interface MemoryState {
  summary: string | null;
  memoryVersion: number;
  /** Structured facts extracted from conversation: { "budget": "50M Q3", "deadline": "Sep 30" } */
  facts: Record<string, string>;
}

/** JSONB shape stored in sessions.extracted_facts */
export type ExtractedFacts = Record<string, string>;

// ─── Constants ───────────────────────────────────────────────────────────────────

/** Model used for summary generation — reserved from routing, not used for inference. */
const SUMMARY_MODEL = 'qwen.qwen3-32b-v1:0';
const SUMMARY_TIMEOUT_MS = 10_000;
const SUMMARY_MAX_TOKENS = 1024;

/** Bedrock client for summary calls. Same region as inference (ap-southeast-3). */
const bedrockClient = new BedrockRuntimeClient({
  region: config.aws.region,
});

// ─── Public API ──────────────────────────────────────────────────────────────────

/**
 * Load the current memory state for a session (summary + facts).
 * Returns null summary, empty facts, and version 0 if no memory has been stored yet.
 * Graceful degradation: returns empty state on DB failure (never throws).
 */
export async function loadMemoryState(sessionId: string): Promise<MemoryState> {
  try {
    const result = await query<{
      rolling_summary: string | null;
      memory_version: number;
      extracted_facts: Record<string, string> | null;
    }>(
      'SELECT rolling_summary, memory_version, extracted_facts FROM sessions WHERE id = $1',
      [sessionId],
    );
    if (result.rows.length === 0) return { summary: null, memoryVersion: 0, facts: {} };
    return {
      summary: result.rows[0].rolling_summary,
      memoryVersion: result.rows[0].memory_version,
      facts: result.rows[0].extracted_facts ?? {},
    };
  } catch (error) {
    console.error('[session-memory] Failed to load memory state:', (error as Error).message);
    return { summary: null, memoryVersion: 0, facts: {} };
  }
}

/**
 * Summarize a batch of evicted messages and persist the result.
 * Merges the evicted messages into any existing summary to produce a rolling summary.
 *
 * Designed for fire-and-forget usage — callers should not await.
 * Graceful degradation: logs errors but never throws.
 *
 * @param sessionId     Session to update.
 * @param evictedMessages  Messages that were dropped from the context window.
 * @param existingSummary  Previous summary from the DB (null on first eviction).
 */
export async function summarizeEvicted(
  sessionId: string,
  evictedMessages: StoredMessage[],
  existingSummary: string | null,
): Promise<void> {
  if (evictedMessages.length === 0) return;

  const newSummary = await generateSummary(evictedMessages, existingSummary);
  if (!newSummary) {
    console.warn('[session-memory] Summary generation returned empty — skipping update');
    return;
  }

  try {
    await query(
      `UPDATE sessions SET rolling_summary = $1, memory_version = memory_version + 1 WHERE id = $2`,
      [newSummary, sessionId],
    );
    console.log(`[session-memory] Session ${sessionId}: summary refreshed (v${existingSummary ? '?' : '0'} → ${newSummary.length} chars)`);
  } catch (error: unknown) {
    console.error('[session-memory] Failed to persist summary:', (error as Error).message);
  }
}

/**
 * Extract structured facts from a single turn of conversation.
 * Calls Bedrock (qwen3-32b) to produce key-value pairs from the current user
 * message and assistant response. Merges with existing facts (new values
 * overwrite old ones for the same key).
 *
 * Fire-and-forget from the caller's perspective. Graceful degradation.
 *
 * @param sessionId      Session to update.
 * @param userPrompt     Current turn's user prompt (already PII-masked).
 * @param assistantText  Current turn's assistant response (already PII-masked).
 * @param existingFacts  Current facts object from DB.
 */
export async function extractFacts(
  sessionId: string,
  userPrompt: string,
  assistantText: string,
  existingFacts: Record<string, string>,
): Promise<void> {
  const newFacts = await generateFacts(userPrompt, assistantText);
  if (!newFacts || Object.keys(newFacts).length === 0) return;

  // Merge: new facts overwrite existing keys
  const merged = { ...existingFacts, ...newFacts };

  try {
    await query(
      `UPDATE sessions SET extracted_facts = $1::jsonb WHERE id = $2`,
      [JSON.stringify(merged), sessionId],
    );
    const added = Object.keys(newFacts).length;
    console.log(`[session-memory] Session ${sessionId}: ${added} fact(s) extracted (${Object.keys(merged).length} total)`);
  } catch (error: unknown) {
    console.error('[session-memory] Failed to persist facts:', (error as Error).message);
  }
}

// ─── Internal Helpers ───────────────────────────────────────────────────────────

/**
 * Call Bedrock Converse (qwen3-32b, non-streaming) to generate or extend a
 * rolling summary from evicted messages.
 *
 * Input includes:
 *   - Existing summary (if any) — the accumulated summary from prior evictions.
 *   - Evicted messages (user + assistant) with role prefixes.
 *
 * Returns the new summary text, or null on failure (graceful degradation).
 */
async function generateSummary(
  evictedMessages: StoredMessage[],
  existingSummary: string | null,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

  try {
    const turns = evictedMessages
      .map(m => `${m.role}: ${m.sanitizedContent}`)
      .join('\n');

    const context = existingSummary
      ? `Previous summary:\n${existingSummary}\n\nNew messages to incorporate:\n${turns}`
      : `Messages to summarize:\n${turns}`;

    const systemPrompt = [
      'You are a conversation summarizer. Produce an updated concise summary.',
      'Focus on: decisions made, user preferences/constraints, unresolved items, key facts discussed.',
      'Keep it under 400 words. Omit greetings and small talk. Write in plain text, no markdown.',
      'Preserve specific values (dates, amounts, names).',
      'If there is a previous summary, incorporate the new messages into it — do not repeat the entire previous summary verbatim.',
    ].join('\n');

    const command = new ConverseCommand({
      modelId: SUMMARY_MODEL,
      system: [{ text: systemPrompt }],
      messages: [{ role: 'user', content: [{ text: context }] }],
      inferenceConfig: {
        maxTokens: SUMMARY_MAX_TOKENS,
        temperature: 0.3,
      },
    });

    const response = await bedrockClient.send(command, {
      abortSignal: controller.signal,
    });

    const text = response.output?.message?.content?.[0]?.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (error) {
    console.error('[session-memory] Summary generation failed:', (error as Error).message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call Bedrock Converse (qwen3-32b, non-streaming) to extract structured
 * key-value facts from a single user→assistant turn.
 *
 * Prompt instructs the model to extract: numeric values, decisions, preferences,
 * deadlines, constraints, named entities, and unresolved items.
 *
 * Returns a flat key-value map, or null on failure.
 */
async function generateFacts(
  userPrompt: string,
  assistantText: string,
): Promise<Record<string, string> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

  try {
    const context = `User: ${userPrompt}\nAssistant: ${assistantText}`;

    const systemPrompt = [
      'Extract key facts from this conversation turn as JSON key-value pairs.',
      'Focus on: decisions made, numeric values (amounts, dates, counts), preferences, constraints, named entities, unresolved items.',
      '',
      'Rules:',
      '- Keys: short snake_case labels, English.',
      '- Values: exact quoted strings from the conversation.',
      '- If no facts found, return {}',
      '- Do NOT include greetings, small talk, or meta-instructions.',
      '- Output ONLY valid JSON. No markdown, no explanations.',
      '',
      'Example: {"budget_amount": "50M IDR", "deadline": "Q3 2026", "approved_by": "Budi"}',
    ].join('\n');

    const command = new ConverseCommand({
      modelId: SUMMARY_MODEL,
      system: [{ text: systemPrompt }],
      messages: [{ role: 'user', content: [{ text: context }] }],
      inferenceConfig: {
        maxTokens: 512,
        temperature: 0.1,
      },
    });

    const response = await bedrockClient.send(command, {
      abortSignal: controller.signal,
    });

    const raw = response.output?.message?.content?.[0]?.text?.trim();
    if (!raw) return null;

    // Strip markdown fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    const parsed = JSON.parse(jsonStr);

    if (typeof parsed !== 'object' || parsed === null) return null;

    // Validate: ensure all values are strings
    const facts: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof key === 'string' && typeof value === 'string' && value.length > 0) {
        facts[key] = value;
      }
    }

    return Object.keys(facts).length > 0 ? facts : null;
  } catch (error) {
    console.error('[session-memory] Fact extraction failed:', (error as Error).message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Testing Hooks ───────────────────────────────────────────────────────────────

/** Inject a mock Bedrock client for unit tests. */
export function _setBedrockClient(client: BedrockRuntimeClient): void {
  Object.assign(bedrockClient, client);
}

export { bedrockClient as _bedrockClient };
