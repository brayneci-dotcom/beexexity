/**
 * Sub-Agent Synthesizer
 *
 * Merges sub-agent outputs into a final response using qwen3-235b.
 * Features per-agent token budget summarization guard and structured
 * fallback if the synthesis LLM fails.
 *
 * @see docs/feat-sub-agent/design.md
 */

import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { Response } from 'express';
import { config } from '../config/index.js';
import { auditService } from './audit.service.js';
import type { SubAgentSpec, SubAgentResult } from '../types/subagent.types.js';
import { SUBAGENT_SYNTHESIS_SYSTEM_PROMPT } from '../prompts/subagent-synthesis.prompt.js';

const bedrockClient = new BedrockRuntimeClient({
  region: config.aws.region,
});

/**
 * Synthesize sub-agent results into a final response.
 *
 * 1. Per-agent token budget check — if any agent output exceeds its share,
 *    run per-agent qwen3-32b summarization on that output only.
 * 2. Call qwen3-235b with synthesis prompt + agent results.
 * 3. Stream synthesis_delta SSE events.
 * 4. Structured fallback if synthesis LLM fails.
 */
export async function synthesize(
  specs: SubAgentSpec[],
  results: SubAgentResult[],
  res: Response,
  sessionId?: string,
  userId?: string,
  username?: string,
): Promise<{ text: string; inputTokens: number; outputTokens: number; summarizeTriggered: boolean }> {
  const synthesisStartTime = Date.now();
  const agentCount = Math.max(results.filter(r => r.status === 'success').length, 1);
  const perAgentBudget = Math.floor(config.subagent.tokenBudget / agentCount);
  let summarizeTriggered = false;

  // Step 1: Per-agent token budget guard — summarize oversized outputs
  const processedResults = await Promise.all(
    results.map(async (result) => {
      if (result.status !== 'success') return result;

      // Rough token estimate (4 chars ≈ 1 token)
      const estimatedTokens = result.text.length / 4;
      if (estimatedTokens > perAgentBudget) {
        summarizeTriggered = true;
        const summarized = await summarizeAgentOutput(result.text);
        return { ...result, text: summarized };
      }
      return result;
    }),
  );

  // Step 2: Build synthesis prompt from agent results
  const parts: string[] = [];
  for (const result of processedResults) {
    parts.push(`## Agent: ${result.agentId}`);
    if (result.status === 'success') {
      parts.push(result.text);
    } else {
      parts.push(`[${result.status.toUpperCase()}] ${result.errorMessage || 'Agent failed'}`);
    }
    parts.push('');
  }
  const agentBlob = parts.join('\n');

  // Step 3: Call qwen3-235b with streaming synthesis
  const synthesisModelId = 'qwen.qwen3-235b-a22b-2507-v1:0';

  try {
    const command = new ConverseStreamCommand({
      modelId: synthesisModelId,
      system: [{ text: SUBAGENT_SYNTHESIS_SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: [{ text: agentBlob }] }],
      inferenceConfig: {
        maxTokens: 16384,
        temperature: 0.3,
      },
    });

    const response = await bedrockClient.send(command);

    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    if (response.stream) {
      for await (const chunk of response.stream) {
        if (chunk.contentBlockDelta?.delta?.text) {
          const token = chunk.contentBlockDelta.delta.text;
          fullText += token;
          // Stream synthesis_delta events
          res.write(`event: synthesis_delta\ndata: ${JSON.stringify({ type: 'text', content: token })}\n\n`);
        }
        if (chunk.metadata?.usage) {
          inputTokens = chunk.metadata.usage.inputTokens ?? 0;
          outputTokens = chunk.metadata.usage.outputTokens ?? 0;
        }
      }
    }

    // Log synthesis call (fire-and-forget)
    auditService.log({
      timestamp: new Date().toISOString(),
      userId: userId ?? 'synthesizer',
      username: username ?? 'synthesizer',
      modelId: synthesisModelId,
      inputTokens,
      outputTokens,
      status: 'success',
      durationMs: Date.now() - (synthesisStartTime ?? Date.now()),
      sessionId,
    }).catch(() => {});

    return {
      text: fullText.trim(),
      inputTokens,
      outputTokens,
      summarizeTriggered,
    };
  } catch (error: unknown) {
    // Step 4: Structured fallback — wrap in markdown message
    console.warn('[synthesizer] Synthesis LLM failed:', (error as Error).message);
    const fallbackText = buildFallbackText(results);
    // Emit fallback as synthesis_delta
    res.write(`event: synthesis_delta\ndata: ${JSON.stringify({ type: 'text', content: fallbackText })}\n\n`);

    // Log failed synthesis (fire-and-forget)
    auditService.log({
      timestamp: new Date().toISOString(),
      userId: userId ?? 'synthesizer',
      username: username ?? 'synthesizer',
      modelId: synthesisModelId,
      inputTokens: 0,
      outputTokens: 0,
      status: 'failed',
      errorCategory: 'model_error',
      durationMs: Date.now() - (synthesisStartTime ?? Date.now()),
      sessionId,
    }).catch(() => {});

    return {
      text: fallbackText,
      inputTokens: 0,
      outputTokens: 0,
      summarizeTriggered,
    };
  }
}

/**
 * Summarize an oversized agent output using qwen3-32b.
 */
async function summarizeAgentOutput(text: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const command = new ConverseCommand({
      modelId: 'qwen.qwen3-32b-v1:0',
      system: [{ text: 'Summarize the following content concisely while preserving all key facts, numbers, and conclusions. Output only the summary.' }],
      messages: [{ role: 'user', content: [{ text }] }],
      inferenceConfig: { maxTokens: 2048, temperature: 0.1 },
    });

    const response = await bedrockClient.send(command, { abortSignal: controller.signal });
    return response.output?.message?.content?.[0]?.text?.trim() ?? text;
  } catch (error) {
    console.warn('[synthesizer] Per-agent summarization failed, using original text:', (error as Error).message);
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Build a structured Markdown fallback message when synthesis LLM fails.
 */
function buildFallbackText(results: SubAgentResult[]): string {
  const parts = [
    '# Partial Results',
    '',
    '_The response merger encountered an error. Below are the individual agent outputs:_',
    '',
  ];

  for (const result of results) {
    parts.push(`## Agent: ${result.agentId}`);
    if (result.status === 'success') {
      parts.push(result.text || '(empty)');
    } else {
      parts.push(`_${result.status.toUpperCase()}: ${result.errorMessage || 'No details'}_`);
    }
    parts.push('');
  }

  return parts.join('\n');
}
