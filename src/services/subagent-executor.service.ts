/**
 * Sub-Agent Executor
 *
 * Runs sub-agents in parallel with a concurrency limit. Each agent makes a
 * non-streaming Bedrock Converse call, then emits a single subagent_delta SSE
 * event with the result (done/failed). PII-masks each output.
 *
 * Executor does NOT use generate() from inference.service — that function
 * writes SSE delta events to res which would interleave across agents.
 * Instead, direct non-streaming ConverseCommand calls.
 *
 * @see docs/feat-sub-agent/design.md
 */

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Response } from 'express';
import { mask } from './pii-masker.service.js';
import { auditService } from './audit.service.js';
import { config } from '../config/index.js';
import type { SubAgentSpec, SubAgentResult } from '../types/subagent.types.js';

const bedrockClient = new BedrockRuntimeClient({
  region: config.aws.region,
});

/**
 * Execute all sub-agents in parallel with a concurrency limit.
 * Streams subagent_delta SSE events per agent (running → done/failed).
 * PII-masks each agent's output before returning.
 */
export async function executeAll(
  specs: SubAgentSpec[],
  res: Response,
  sessionId?: string,
  userId?: string,
  username?: string,
): Promise<SubAgentResult[]> {
  const results: SubAgentResult[] = [];
  const concurrency = config.subagent.concurrency;

  for (let i = 0; i < specs.length; i += concurrency) {
    const batch = specs.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(spec => executeOne(spec, res, sessionId, userId, username)),
    );

    for (let j = 0; j < batchResults.length; j++) {
      const r = batchResults[j];
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({
          agentId: batch[j].agentId,
          status: 'failed',
          text: '',
          errorMessage: r.reason?.message ?? 'Unknown error',
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
        });
      }
    }
  }

  return results;
}

/**
 * Execute a single sub-agent via non-streaming Bedrock Converse.
 */
async function executeOne(
  spec: SubAgentSpec,
  res: Response,
  sessionId?: string,
  userId?: string,
  username?: string,
): Promise<SubAgentResult> {
  const startTime = Date.now();
  const agentId = spec.agentId;
  const modelId = spec.targetModel || 'qwen.qwen3-235b-a22b-2507-v1:0';

  // Emit running event (no text for running — frontend knows to wait)
  writeSubAgentDelta(res, agentId, 'running');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.subagent.timeoutMs);

  try {
    const command = new ConverseCommand({
      modelId,
      messages: [{ role: 'user', content: [{ text: spec.prompt }] }],
      inferenceConfig: {
        maxTokens: 8192,
        temperature: 0.3,
      },
    });

    const response = await bedrockClient.send(command, {
      abortSignal: controller.signal,
    });

    const durationMs = Date.now() - startTime;
    const rawText = response.output?.message?.content?.[0]?.text?.trim() ?? '';

    // PII-mask output before returning to synthesizer
    const maskedText = mask(rawText).maskedText;

    const usage = response.usage ?? { inputTokens: 0, outputTokens: 0 };

    writeSubAgentDelta(res, agentId, 'done');

    // Log sub-agent call to audit_logs (fire-and-forget)
    auditService.log({
      timestamp: new Date().toISOString(),
      userId: userId ?? 'subagent',
      username: username ?? 'subagent',
      modelId,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      status: 'success',
      durationMs,
      sessionId,
    }).catch(() => {});

    return {
      agentId,
      status: 'success',
      text: maskedText,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      durationMs,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    let errorMessage = 'Sub-agent execution failed';

    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        errorMessage = 'Sub-agent timed out';
      } else {
        errorMessage = error.message;
      }
    }

    writeSubAgentDelta(res, agentId, 'failed');

    // Log failed sub-agent (fire-and-forget)
    auditService.log({
      timestamp: new Date().toISOString(),
      userId: userId ?? 'subagent',
      username: username ?? 'subagent',
      modelId,
      inputTokens: 0,
      outputTokens: 0,
      status: 'failed',
      errorCategory: errorMessage?.toLowerCase().includes('timeout') ? 'timeout' : 'model_error',
      durationMs,
      sessionId,
    }).catch(() => {});

    return {
      agentId,
      status: durationMs >= config.subagent.timeoutMs ? 'timeout' : 'failed',
      text: '',
      errorMessage,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Write a subagent_delta SSE event.
 * When status=running, text is NOT streamed incrementally — the full result
 * arrives on the done/failed event. Frontend shows a "Agent X running..." indicator.
 */
function writeSubAgentDelta(
  res: Response,
  agentId: string,
  status: 'running' | 'done' | 'failed',
): void {
  res.write(`event: subagent_delta\ndata: ${JSON.stringify({ agentId, status })}\n\n`);
}
