import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  isThrottlingError,
  isTimeoutError,
  sanitizeError,
  InferenceError,
} from '../../src/services/inference.service.js';

describe('Inference Retry Logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isThrottlingError', () => {
    it('returns true for ThrottlingException name', () => {
      const error = { name: 'ThrottlingException', message: 'Rate exceeded' };
      expect(isThrottlingError(error)).toBe(true);
    });

    it('returns true for HTTP 429 in $metadata', () => {
      const error = {
        name: 'SomeError',
        message: 'Too many requests',
        $metadata: { httpStatusCode: 429 },
      };
      expect(isThrottlingError(error)).toBe(true);
    });

    it('returns false for non-throttling errors', () => {
      const error = { name: 'ValidationException', message: 'Invalid input' };
      expect(isThrottlingError(error)).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isThrottlingError(null)).toBe(false);
      expect(isThrottlingError(undefined)).toBe(false);
    });

    it('returns false for non-object values', () => {
      expect(isThrottlingError('string')).toBe(false);
      expect(isThrottlingError(42)).toBe(false);
    });

    it('returns false for errors with non-429 status codes', () => {
      const error = {
        name: 'SomeError',
        $metadata: { httpStatusCode: 500 },
      };
      expect(isThrottlingError(error)).toBe(false);
    });
  });

  describe('isTimeoutError', () => {
    it('returns true for TimeoutError name', () => {
      const error = { name: 'TimeoutError', message: 'Request timed out' };
      expect(isTimeoutError(error)).toBe(true);
    });

    it('returns true for error with timeout in message', () => {
      const error = { name: 'SomeError', message: 'Connection timeout occurred' };
      expect(isTimeoutError(error)).toBe(true);
    });

    it('returns true for uppercase TIMEOUT in message', () => {
      const error = { name: 'SomeError', message: 'REQUEST TIMEOUT' };
      expect(isTimeoutError(error)).toBe(true);
    });

    it('returns false for non-timeout errors', () => {
      const error = { name: 'ValidationException', message: 'Invalid input' };
      expect(isTimeoutError(error)).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isTimeoutError(null)).toBe(false);
      expect(isTimeoutError(undefined)).toBe(false);
    });
  });

  describe('sanitizeError', () => {
    it('returns InferenceError with throttling category', () => {
      const rawError = {
        name: 'ThrottlingException',
        message: 'arn:aws:bedrock:ap-southeast-3:123456789:model/qwen req-id-xyz',
        $metadata: { requestId: 'abc-123' },
      };
      const sanitized = sanitizeError(rawError, 'throttling');

      expect(sanitized).toBeInstanceOf(InferenceError);
      expect(sanitized.category).toBe('throttling');
      expect(sanitized.statusCode).toBe(503);
      expect(sanitized.message).toBe('Service temporarily busy. Please try again later.');
      expect(sanitized.message).not.toContain('arn:aws');
      expect(sanitized.message).not.toContain('req-id-xyz');
    });

    it('returns InferenceError with timeout category', () => {
      const sanitized = sanitizeError(new Error('timed out'), 'timeout');

      expect(sanitized).toBeInstanceOf(InferenceError);
      expect(sanitized.category).toBe('timeout');
      expect(sanitized.statusCode).toBe(504);
      expect(sanitized.message).toBe('Model response timed out. Please try again.');
    });

    it('returns InferenceError with model_error category', () => {
      const sanitized = sanitizeError(new Error('model failed'), 'model_error');

      expect(sanitized).toBeInstanceOf(InferenceError);
      expect(sanitized.category).toBe('model_error');
      expect(sanitized.statusCode).toBe(502);
      expect(sanitized.message).toBe('Model processing error. Please try a different model or try again later.');
    });

    it('never exposes AWS ARNs in sanitized messages', () => {
      const rawError = {
        name: 'ModelError',
        message: 'Error invoking arn:aws:bedrock:ap-southeast-3:111222333:model/test-model',
      };
      const sanitized = sanitizeError(rawError, 'model_error');
      expect(sanitized.message).not.toMatch(/arn:aws/);
    });

    it('never exposes request IDs in sanitized messages', () => {
      const rawError = {
        name: 'InternalError',
        message: 'Internal failure',
        $metadata: { requestId: 'req-abc-def-123' },
      };
      const sanitized = sanitizeError(rawError, 'model_error');
      expect(sanitized.message).not.toContain('req-abc-def-123');
    });
  });

  describe('withRetry', () => {
    it('returns result on first successful call', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const delayFn = vi.fn();

      const result = await withRetry(fn, delayFn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(delayFn).not.toHaveBeenCalled();
    });

    it('retries on throttling error and succeeds', async () => {
      const throttlingError = { name: 'ThrottlingException', message: 'Rate exceeded' };
      const fn = vi.fn()
        .mockRejectedValueOnce(throttlingError)
        .mockResolvedValue('success after retry');
      const delayFn = vi.fn().mockResolvedValue(undefined);

      const result = await withRetry(fn, delayFn);

      expect(result).toBe('success after retry');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(delayFn).toHaveBeenCalledTimes(1);
      expect(delayFn).toHaveBeenCalledWith(1000); // 1000 * 2^0
    });

    it('applies exponential backoff delays', async () => {
      const throttlingError = { name: 'ThrottlingException', message: 'Rate exceeded' };
      const fn = vi.fn()
        .mockRejectedValueOnce(throttlingError)
        .mockRejectedValueOnce(throttlingError)
        .mockRejectedValueOnce(throttlingError)
        .mockResolvedValue('success after 3 retries');
      const delayFn = vi.fn().mockResolvedValue(undefined);

      const result = await withRetry(fn, delayFn);

      expect(result).toBe('success after 3 retries');
      expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
      expect(delayFn).toHaveBeenCalledTimes(3);
      expect(delayFn).toHaveBeenNthCalledWith(1, 1000); // 1000 * 2^0
      expect(delayFn).toHaveBeenNthCalledWith(2, 2000); // 1000 * 2^1
      expect(delayFn).toHaveBeenNthCalledWith(3, 4000); // 1000 * 2^2
    });

    it('throws sanitized throttling error after max retries exhausted', async () => {
      const throttlingError = { name: 'ThrottlingException', message: 'arn:aws:bedrock:...' };
      const fn = vi.fn().mockRejectedValue(throttlingError);
      const delayFn = vi.fn().mockResolvedValue(undefined);

      await expect(withRetry(fn, delayFn)).rejects.toThrow(InferenceError);
      await expect(withRetry(fn, delayFn)).rejects.toMatchObject({
        category: 'throttling',
        statusCode: 503,
        message: 'Service temporarily busy. Please try again later.',
      });

      // initial call + 3 retries = 4 total calls per invocation
      expect(fn).toHaveBeenCalledTimes(8); // 2 invocations × 4
    });

    it('does not retry on timeout errors — throws immediately', async () => {
      const timeoutError = { name: 'TimeoutError', message: 'Request timed out' };
      const fn = vi.fn().mockRejectedValue(timeoutError);
      const delayFn = vi.fn().mockResolvedValue(undefined);

      await expect(withRetry(fn, delayFn)).rejects.toThrow(InferenceError);
      await expect(withRetry(fn, delayFn)).rejects.toMatchObject({
        category: 'timeout',
        statusCode: 504,
        message: 'Model response timed out. Please try again.',
      });

      expect(fn).toHaveBeenCalledTimes(2); // 1 per invocation, no retries
      expect(delayFn).not.toHaveBeenCalled();
    });

    it('does not retry on model errors — throws immediately', async () => {
      const modelError = {
        name: 'ModelError',
        message: 'Model failed arn:aws:bedrock:ap-southeast-3:123:model/test',
      };
      const fn = vi.fn().mockRejectedValue(modelError);
      const delayFn = vi.fn().mockResolvedValue(undefined);

      await expect(withRetry(fn, delayFn)).rejects.toThrow(InferenceError);
      await expect(withRetry(fn, delayFn)).rejects.toMatchObject({
        category: 'model_error',
        statusCode: 502,
      });

      expect(fn).toHaveBeenCalledTimes(2); // 1 per invocation, no retries
      expect(delayFn).not.toHaveBeenCalled();
    });

    it('retries on HTTP 429 metadata errors', async () => {
      const http429Error = {
        name: 'ServiceException',
        message: 'Too many requests',
        $metadata: { httpStatusCode: 429 },
      };
      const fn = vi.fn()
        .mockRejectedValueOnce(http429Error)
        .mockResolvedValue('recovered');
      const delayFn = vi.fn().mockResolvedValue(undefined);

      const result = await withRetry(fn, delayFn);

      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(delayFn).toHaveBeenCalledWith(1000);
    });

    it('sanitized error never contains AWS ARNs after retries exhausted', async () => {
      const throttlingError = {
        name: 'ThrottlingException',
        message: 'Error for arn:aws:bedrock:ap-southeast-3:123456789012:model/qwen.qwen3-32b-v1',
        $metadata: { requestId: 'req-id-abc-123-xyz' },
      };
      const fn = vi.fn().mockRejectedValue(throttlingError);
      const delayFn = vi.fn().mockResolvedValue(undefined);

      try {
        await withRetry(fn, delayFn);
      } catch (error) {
        expect(error).toBeInstanceOf(InferenceError);
        const infError = error as InferenceError;
        expect(infError.message).not.toMatch(/arn:aws/);
        expect(infError.message).not.toContain('req-id-abc-123-xyz');
        expect(infError.message).not.toContain('123456789012');
      }
    });

    it('makes exactly 4 total attempts (1 initial + 3 retries) on persistent throttling', async () => {
      const throttlingError = { name: 'ThrottlingException', message: 'Rate exceeded' };
      const fn = vi.fn().mockRejectedValue(throttlingError);
      const delayFn = vi.fn().mockResolvedValue(undefined);

      await expect(withRetry(fn, delayFn)).rejects.toThrow(InferenceError);

      expect(fn).toHaveBeenCalledTimes(4);
      expect(delayFn).toHaveBeenCalledTimes(3);
    });
  });
});
