/**
 * Unit tests for the Session Memory Service.
 * Tests memory state loading, summary generation, and graceful degradation.
 *
 * @see Requirements 3.x
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database module
vi.mock('../../src/config/database.js', () => ({
  query: vi.fn(),
}));

// Mock @aws-sdk/client-bedrock-runtime
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  const mockSend = vi.fn();
  return {
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    ConverseCommand: vi.fn().mockImplementation((input) => input),
    __mockSend: mockSend,
  };
});

import { query } from '../../src/config/database.js';
import {
  loadMemoryState,
  summarizeEvicted,
  extractFacts,
  _setBedrockClient,
} from '../../src/services/session-memory.service.js';
import type { StoredMessage } from '../../src/types/session.types.js';

const mockQuery = vi.mocked(query);
const { __mockSend: mockSend } = await import('@aws-sdk/client-bedrock-runtime') as any;

function makeMessage(id: string, role: 'user' | 'assistant', content: string): StoredMessage {
  return {
    id,
    sessionId: 'session-1',
    role,
    sanitizedContent: content,
    createdAt: new Date().toISOString(),
    storageFlags: { piiMasked: true },
  };
}

describe('session-memory.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadMemoryState', () => {
    it('returns summary, version and facts from DB query', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          rolling_summary: 'User asked about budgets.',
          memory_version: 2,
          extracted_facts: { budget: '50M Q3', deadline: 'Sep 30' },
        }],
        rowCount: 1,
      } as never);

      const state = await loadMemoryState('session-1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT rolling_summary, memory_version, extracted_facts'),
        ['session-1'],
      );
      expect(state).toEqual({
        summary: 'User asked about budgets.',
        memoryVersion: 2,
        facts: { budget: '50M Q3', deadline: 'Sep 30' },
      });
    });

    it('returns empty state when session not found', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

      const state = await loadMemoryState('session-999');
      expect(state).toEqual({ summary: null, memoryVersion: 0, facts: {} });
    });

    it('returns empty state on DB error (graceful degradation)', async () => {
      mockQuery.mockRejectedValue(new Error('DB connection lost'));

      const state = await loadMemoryState('session-1');
      expect(state).toEqual({ summary: null, memoryVersion: 0, facts: {} });
    });

    it('returns empty facts when DB has null', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ rolling_summary: null, memory_version: 0, extracted_facts: null }],
        rowCount: 1,
      } as never);

      const state = await loadMemoryState('session-1');
      expect(state).toEqual({ summary: null, memoryVersion: 0, facts: {} });
    });
  });

  describe('summarizeEvicted', () => {
    it('skips when no evicted messages', async () => {
      await summarizeEvicted('session-1', [], null);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('generates summary and persists it', async () => {
      const evicted = [
        makeMessage('1', 'user', 'What is the budget for Q3?'),
        makeMessage('2', 'assistant', 'The Q3 budget is 50M IDR.'),
      ];

      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: 'User asked about Q3 budget — 50M IDR.' }],
          },
        },
      });

      mockQuery.mockResolvedValue({ rowCount: 1 } as never);

      await summarizeEvicted('session-1', evicted, null);

      // Should have called the DB update
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions'),
        ['User asked about Q3 budget — 50M IDR.', 'session-1'],
      );
    });

    it('merges with existing summary', async () => {
      const evicted = [
        makeMessage('3', 'user', 'Can we increase it to 60M?'),
        makeMessage('4', 'assistant', 'Approved. Budget increased to 60M IDR.'),
      ];

      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: 'Q3 budget: 50M IDR initially, then increased to 60M IDR.' }],
          },
        },
      });

      mockQuery.mockResolvedValue({ rowCount: 1 } as never);

      await summarizeEvicted('session-1', evicted, 'User asked about Q3 budget — 50M IDR.');

      // Verify the existing summary was passed to the model
      const calls = mockSend.mock.calls;
      expect(calls.length).toBe(1);
      const commandInput = calls[0][0]; // ConverseCommand input
      const userMsg = commandInput.messages[0].content[0].text;
      expect(userMsg).toContain('Previous summary');
      expect(userMsg).toContain('User asked about Q3 budget');
      expect(userMsg).toContain('Can we increase it to 60M');
    });

    it('handles Bedrock failure gracefully', async () => {
      const evicted = [
        makeMessage('1', 'user', 'Hello'),
        makeMessage('2', 'assistant', 'Hi there!'),
      ];

      mockSend.mockRejectedValue(new Error('Bedrock timeout'));
      mockQuery.mockResolvedValue({ rowCount: 1 } as never);

      // Should not throw
      await expect(summarizeEvicted('session-1', evicted, null)).resolves.toBeUndefined();
      // DB should NOT be updated
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('handles empty Bedrock response gracefully', async () => {
      const evicted = [makeMessage('1', 'user', 'Hello')];

      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: '' }],
          },
        },
      });

      await summarizeEvicted('session-1', evicted, null);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('handles DB update failure gracefully', async () => {
      const evicted = [makeMessage('1', 'user', 'Hello')];
      const summary = 'User said hello.';

      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: summary }],
          },
        },
      });

      mockQuery.mockRejectedValue(new Error('DB write failed'));

      await expect(summarizeEvicted('session-1', evicted, null)).resolves.toBeUndefined();
    });
  });

  describe('extractFacts', () => {
    it('extracts facts and merges with existing', async () => {
      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: '{"budget": "50M Q3", "deadline": "Sep 30"}' }],
          },
        },
      });
      mockQuery.mockResolvedValue({ rowCount: 1 } as never);

      await extractFacts('session-1', 'What is the budget?', 'The budget is 50M for Q3.', {});

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sessions'),
        [
          expect.stringContaining('"budget"'),
          'session-1',
        ],
      );
    });

    it('overwrites existing fact keys with new values', async () => {
      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: '{"budget": "60M Q3 (updated)"}' }],
          },
        },
      });
      mockQuery.mockResolvedValue({ rowCount: 1 } as never);

      await extractFacts('session-1', 'Increase budget', 'Budget now 60M.', { budget: '50M Q3', deadline: 'Sep 30' });

      // Should have the old deadline preserved but budget overwritten
      const updateCall = mockQuery.mock.calls[0][1];
      const factsJson = JSON.parse(updateCall[0]);
      expect(factsJson.budget).toBe('60M Q3 (updated)');
      expect(factsJson.deadline).toBe('Sep 30');
    });

    it('skips update when no facts extracted', async () => {
      mockSend.mockResolvedValue({
        output: {
          message: {
            content: [{ text: '{}' }],
          },
        },
      });

      await extractFacts('session-1', 'Hi', 'Hello!', {});
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('handles Bedrock failure gracefully', async () => {
      mockSend.mockRejectedValue(new Error('Bedrock error'));

      await expect(extractFacts('session-1', 'Hi', 'Hello!', {})).resolves.toBeUndefined();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
