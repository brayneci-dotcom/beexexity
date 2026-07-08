import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import type { InferenceRequest } from '../../src/types/inference.types.js';

// Mock the database module for validateModelId access checks
vi.mock('../../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }), // no access rows → public model
}));

// Mock the @aws-sdk/client-bedrock-runtime module
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  const mockSend = vi.fn();
  return {
    BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    ConverseStreamCommand: vi.fn().mockImplementation((input) => input),
    __mockSend: mockSend,
  };
});

import { validateModelId, generate } from '../../src/services/inference.service.js';

// Get access to mock send function
const { __mockSend: mockSend } = await import('@aws-sdk/client-bedrock-runtime') as any;

function createMockResponse(): Response & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    write: vi.fn((data: string) => {
      written.push(data);
      return true;
    }),
  } as unknown as Response & { written: string[] };
}

/** Helper to create an async iterable stream from events */
async function* createMockStream(events: any[]) {
  for (const event of events) {
    yield event;
  }
}

describe('inference.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateModelId', () => {
    it('should return default model when no modelId provided', async () => {
      await expect(validateModelId()).resolves.toBe('qwen.qwen3-32b-v1:0');
      await expect(validateModelId('')).resolves.toBe('qwen.qwen3-32b-v1:0');
      await expect(validateModelId(undefined)).resolves.toBe('qwen.qwen3-32b-v1:0');
    });

    it('should accept valid model IDs', async () => {
      await expect(validateModelId('openai.gpt-oss-120b-1:0')).resolves.toBe('openai.gpt-oss-120b-1:0');
      await expect(validateModelId('qwen.qwen3-32b-v1:0')).resolves.toBe('qwen.qwen3-32b-v1:0');
    });

    it('should reject invalid model IDs with statusCode 400', async () => {
      try {
        await validateModelId('invalid-model');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('Invalid model');
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('INVALID_MODEL');
      }
    });
  });

  describe('generate', () => {
    const baseRequest: InferenceRequest = {
      maskedPrompt: 'Hello, how are you?',
      modelId: 'qwen.qwen3-32b-v1:0',
      userId: 'user-123',
    };

    it('should stream contentBlockDelta events as SSE delta events', async () => {
      const mockRes = createMockResponse();
      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Hello' } } },
        { contentBlockDelta: { delta: { text: ' world' } } },
        { metadata: { usage: { inputTokens: 10, outputTokens: 5 } } },
        { messageStop: { stopReason: 'end_turn' } },
      ];

      mockSend.mockResolvedValueOnce({ stream: createMockStream(streamEvents) });

      const result = await generate(baseRequest, mockRes);

      expect(mockRes.written[0]).toBe('event: delta\ndata: {"type":"text","content":"Hello"}\n\n');
      expect(mockRes.written[1]).toBe('event: delta\ndata: {"type":"text","content":" world"}\n\n');
      expect(result.status).toBe('success');
    });

    it('should stream metadata events with token counts', async () => {
      const mockRes = createMockResponse();
      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Hi' } } },
        { metadata: { usage: { inputTokens: 42, outputTokens: 156 } } },
        { messageStop: { stopReason: 'end_turn' } },
      ];

      mockSend.mockResolvedValueOnce({ stream: createMockStream(streamEvents) });

      const result = await generate(baseRequest, mockRes);

      expect(mockRes.written[1]).toBe('event: metadata\ndata: {"inputTokens":42,"outputTokens":156}\n\n');
      expect(result.inputTokens).toBe(42);
      expect(result.outputTokens).toBe(156);
    });

    it('should stream done event on messageStop', async () => {
      const mockRes = createMockResponse();
      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Done' } } },
        { metadata: { usage: { inputTokens: 5, outputTokens: 1 } } },
        { messageStop: { stopReason: 'end_turn' } },
      ];

      mockSend.mockResolvedValueOnce({ stream: createMockStream(streamEvents) });

      await generate(baseRequest, mockRes);

      expect(mockRes.written[2]).toBe('event: done\ndata: {}\n\n');
    });

    it('should return InferenceResult with correct token counts and status', async () => {
      const mockRes = createMockResponse();
      const streamEvents = [
        { contentBlockDelta: { delta: { text: 'Response' } } },
        { metadata: { usage: { inputTokens: 20, outputTokens: 30 } } },
        { messageStop: { stopReason: 'end_turn' } },
      ];

      mockSend.mockResolvedValueOnce({ stream: createMockStream(streamEvents) });

      const result = await generate(baseRequest, mockRes);

      expect(result).toEqual({
        status: 'success',
        inputTokens: 20,
        outputTokens: 30,
        modelId: 'qwen.qwen3-32b-v1:0',
      });
    });

    it('should pass inferenceConfig to ConverseStreamCommand when provided', async () => {
      const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');
      const mockRes = createMockResponse();
      const requestWithConfig: InferenceRequest = {
        ...baseRequest,
        inferenceConfig: {
          maxTokens: 1024,
          temperature: 0.7,
          topP: 0.9,
        },
      };

      const streamEvents = [
        { metadata: { usage: { inputTokens: 5, outputTokens: 3 } } },
        { messageStop: { stopReason: 'end_turn' } },
      ];

      mockSend.mockResolvedValueOnce({ stream: createMockStream(streamEvents) });

      await generate(requestWithConfig, mockRes);

      expect(ConverseStreamCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'qwen.qwen3-32b-v1:0',
          messages: [
            {
              role: 'user',
              content: [{ text: 'Hello, how are you?' }],
            },
          ],
          inferenceConfig: {
            maxTokens: 1024,
            temperature: 0.7,
            topP: 0.9,
          },
        }),
      );
    });

    it('should handle empty delta text gracefully', async () => {
      const mockRes = createMockResponse();
      const streamEvents = [
        { contentBlockDelta: { delta: {} } },
        { metadata: { usage: { inputTokens: 1, outputTokens: 0 } } },
        { messageStop: { stopReason: 'end_turn' } },
      ];

      mockSend.mockResolvedValueOnce({ stream: createMockStream(streamEvents) });

      const result = await generate(baseRequest, mockRes);

      expect(mockRes.written[0]).toBe('event: delta\ndata: {"type":"text","content":""}\n\n');
      expect(result.status).toBe('success');
    });

    it('should handle missing usage in metadata gracefully', async () => {
      const mockRes = createMockResponse();
      const streamEvents = [
        { metadata: {} },
        { messageStop: { stopReason: 'end_turn' } },
      ];

      mockSend.mockResolvedValueOnce({ stream: createMockStream(streamEvents) });

      const result = await generate(baseRequest, mockRes);

      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('should handle stream with no events', async () => {
      const mockRes = createMockResponse();
      mockSend.mockResolvedValueOnce({ stream: createMockStream([]) });

      const result = await generate(baseRequest, mockRes);

      expect(result.status).toBe('success');
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(mockRes.written).toHaveLength(0);
    });

    it('should handle null stream response', async () => {
      const mockRes = createMockResponse();
      mockSend.mockResolvedValueOnce({ stream: null });

      const result = await generate(baseRequest, mockRes);

      expect(result.status).toBe('success');
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(mockRes.written).toHaveLength(0);
    });
  });
});
