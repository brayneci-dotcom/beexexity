/**
 * Unit tests for the Context Assembly Service.
 * Tests token estimation, budget enforcement, truncation, and chronological ordering.
 *
 * @see Requirements 3.1, 3.2, 3.3, 3.5, 3.8, 4.1, 4.3
 */

import { describe, it, expect } from 'vitest';
import {
  assembleContext,
  estimateTokens,
} from '../../src/services/context-assembly.service.js';
import type {
  StoredMessage,
  ContextAssemblyConfig,
} from '../../src/types/session.types.js';

function makeMessage(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  createdAt?: string,
): StoredMessage {
  return {
    id,
    sessionId: 'session-1',
    role,
    sanitizedContent: content,
    createdAt: createdAt || new Date().toISOString(),
    storageFlags: { piiMasked: true },
  };
}

const defaultConfig: ContextAssemblyConfig = {
  tokenBudget: 200000,
  safetyMargin: 20000,
  summaryThreshold: 40,
  charsPerToken: 4,
};

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('', 4)).toBe(0);
  });

  it('returns Math.ceil(text.length / charsPerToken) for non-empty text', () => {
    expect(estimateTokens('hello', 4)).toBe(Math.ceil(5 / 4)); // 2
    expect(estimateTokens('abcd', 4)).toBe(1);
    expect(estimateTokens('abcde', 4)).toBe(2);
    expect(estimateTokens('a', 4)).toBe(1);
  });

  it('handles different charsPerToken values', () => {
    expect(estimateTokens('hello world', 2)).toBe(Math.ceil(11 / 2)); // 6
    expect(estimateTokens('hello world', 1)).toBe(11);
    expect(estimateTokens('hello world', 11)).toBe(1);
  });

  it('handles long text', () => {
    const longText = 'a'.repeat(1000);
    expect(estimateTokens(longText, 4)).toBe(250);
  });
});

describe('assembleContext', () => {
  it('returns empty context for empty history', () => {
    const result = assembleContext([], 'hello', defaultConfig);

    expect(result.messages).toHaveLength(0);
    expect(result.totalEstimatedTokens).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.truncatedCount).toBe(0);
    expect(result.summarized).toBe(false);
    expect(result.originalMessageCount).toBe(0);
  });

  it('includes a single message within budget', () => {
    const messages = [makeMessage('1', 'user', 'hello there')];
    const result = assembleContext(messages, 'current prompt', defaultConfig);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content[0].text).toBe('hello there');
    expect(result.totalEstimatedTokens).toBe(estimateTokens('hello there', 4));
    expect(result.truncated).toBe(false);
    expect(result.truncatedCount).toBe(0);
    expect(result.originalMessageCount).toBe(1);
  });

  it('includes multiple messages within budget in chronological order', () => {
    const messages = [
      makeMessage('1', 'user', 'first message', '2024-01-01T00:00:00Z'),
      makeMessage('2', 'assistant', 'first reply', '2024-01-01T00:01:00Z'),
      makeMessage('3', 'user', 'second message', '2024-01-01T00:02:00Z'),
      makeMessage('4', 'assistant', 'second reply', '2024-01-01T00:03:00Z'),
    ];

    const result = assembleContext(messages, 'current prompt', defaultConfig);

    expect(result.messages).toHaveLength(4);
    // Verify chronological order
    expect(result.messages[0].content[0].text).toBe('first message');
    expect(result.messages[1].content[0].text).toBe('first reply');
    expect(result.messages[2].content[0].text).toBe('second message');
    expect(result.messages[3].content[0].text).toBe('second reply');
    expect(result.truncated).toBe(false);
    expect(result.truncatedCount).toBe(0);
    expect(result.originalMessageCount).toBe(4);
  });

  it('truncates oldest messages when budget is exceeded', () => {
    // With charsPerToken=4, each char is 0.25 tokens
    // Set a tight budget: tokenBudget=100, safetyMargin=0
    const tightConfig: ContextAssemblyConfig = {
      tokenBudget: 100,
      safetyMargin: 0,
      summaryThreshold: 40,
      charsPerToken: 4,
    };

    // Each message is 400 chars = 100 tokens
    const longContent = 'a'.repeat(400);
    const messages = [
      makeMessage('1', 'user', longContent, '2024-01-01T00:00:00Z'),
      makeMessage('2', 'assistant', longContent, '2024-01-01T00:01:00Z'),
      makeMessage('3', 'user', 'short', '2024-01-01T00:02:00Z'), // 2 tokens
    ];

    // Current prompt is short; budget is 100 tokens
    // "prompt" = 6 chars / 4 = 2 tokens → history budget = 100 - 2 = 98 tokens
    // Most recent message (msg 3) = 2 tokens → fits, accumulated = 2
    // Next (msg 2) = 100 tokens → 2 + 100 = 102 > 98 → stop
    const result = assembleContext(messages, 'prompt', tightConfig);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content[0].text).toBe('short');
    expect(result.truncated).toBe(true);
    expect(result.truncatedCount).toBe(2);
    expect(result.originalMessageCount).toBe(3);
  });

  it('safety margin is subtracted from budget', () => {
    // tokenBudget=50, safetyMargin=40 → available = 10 tokens for history + prompt
    const tightConfig: ContextAssemblyConfig = {
      tokenBudget: 50,
      safetyMargin: 40,
      summaryThreshold: 40,
      charsPerToken: 4,
    };

    // Current prompt: "hi" = 2 chars / 4 = 1 token → history budget = 10 - 1 = 9 tokens
    // Message: 40 chars = 10 tokens → exceeds 9 → dropped
    const messages = [makeMessage('1', 'user', 'a'.repeat(40))];
    const result = assembleContext(messages, 'hi', tightConfig);

    expect(result.messages).toHaveLength(0);
    expect(result.truncated).toBe(true);
    expect(result.truncatedCount).toBe(1);
  });

  it('returns empty messages when current prompt consumes entire budget', () => {
    const tightConfig: ContextAssemblyConfig = {
      tokenBudget: 100,
      safetyMargin: 50,
      summaryThreshold: 40,
      charsPerToken: 4,
    };

    // Available = 100 - 50 = 50 tokens
    // Current prompt: 200 chars = 50 tokens → history budget = 50 - 50 = 0
    const messages = [makeMessage('1', 'user', 'hello')];
    const result = assembleContext(messages, 'a'.repeat(200), tightConfig);

    expect(result.messages).toHaveLength(0);
    expect(result.truncated).toBe(true);
    expect(result.truncatedCount).toBe(1);
  });

  it('preserves correct BedrockMessage format', () => {
    const messages = [
      makeMessage('1', 'user', 'question one'),
      makeMessage('2', 'assistant', 'answer one'),
    ];
    const result = assembleContext(messages, 'current', defaultConfig);

    expect(result.messages[0]).toEqual({
      role: 'user',
      content: [{ text: 'question one' }],
    });
    expect(result.messages[1]).toEqual({
      role: 'assistant',
      content: [{ text: 'answer one' }],
    });
  });

  it('sets summarized to false (MVP does not implement summary)', () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      makeMessage(`${i}`, i % 2 === 0 ? 'user' : 'assistant', `message ${i}`)
    );
    const result = assembleContext(messages, 'current', defaultConfig);

    expect(result.summarized).toBe(false);
  });

  it('handles exactly-at-budget boundary', () => {
    // tokenBudget=10, safetyMargin=0, charsPerToken=4
    // current prompt: "hi" = 1 token → history budget = 10 - 1 = 9
    const config: ContextAssemblyConfig = {
      tokenBudget: 10,
      safetyMargin: 0,
      summaryThreshold: 40,
      charsPerToken: 4,
    };

    // Message: 36 chars = 9 tokens → exactly fits
    const messages = [makeMessage('1', 'user', 'a'.repeat(36))];
    const result = assembleContext(messages, 'hi', config);

    expect(result.messages).toHaveLength(1);
    expect(result.truncated).toBe(false);
    expect(result.totalEstimatedTokens).toBe(9);
  });

  it('totalEstimatedTokens reflects only included messages', () => {
    const config: ContextAssemblyConfig = {
      tokenBudget: 20,
      safetyMargin: 0,
      summaryThreshold: 40,
      charsPerToken: 4,
    };

    // "current" = 7 chars / 4 = 2 tokens → history budget = 20 - 2 = 18
    // msg3: "ccc" (12 chars) = 3 tokens → accumulated = 3
    // msg2: "bbb" (12 chars) = 3 tokens → accumulated = 6
    // msg1: "aaa" (60 chars) = 15 tokens → 6 + 15 = 21 > 18 → stop
    const messages = [
      makeMessage('1', 'user', 'a'.repeat(60), '2024-01-01T00:00:00Z'),
      makeMessage('2', 'assistant', 'b'.repeat(12), '2024-01-01T00:01:00Z'),
      makeMessage('3', 'user', 'c'.repeat(12), '2024-01-01T00:02:00Z'),
    ];

    const result = assembleContext(messages, 'current', config);

    expect(result.messages).toHaveLength(2);
    expect(result.totalEstimatedTokens).toBe(6); // 3 + 3
    expect(result.truncated).toBe(true);
    expect(result.truncatedCount).toBe(1);
  });
});
