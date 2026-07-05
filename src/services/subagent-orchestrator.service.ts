/**
 * Sub-Agent Orchestrator
 *
 * Main orchestration loop: plan → opt-out gate → injectContext → execute → synthesize.
 * Returns the final assistant text + orchestrationMeta for audit.
 *
 * @see docs/feat-sub-agent/design.md
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { Response } from 'express';
import { generate } from './inference.service.js';
import { auditService } from './audit.service.js';
import { executeAll } from './subagent-executor.service.js';
import { synthesize } from './subagent-synthesizer.service.js';
import { config } from '../config/index.js';
import { SUBAGENT_PLANNER_SYSTEM_PROMPT } from '../prompts/subagent-planner.prompt.js';
import type { SubAgentSpec, SubAgentResult, OrchestrationMeta } from '../types/subagent.types.js';
import type { ConversationInferenceRequest, ConversationInferenceResult } from '../types/session.types.js';
import type { RoutingDecision } from '../types/routing.types.js';

const bedrockClient = new BedrockRuntimeClient({
  region: config.aws.region,
});

export interface OrchestrateInput {
  originalPrompt: string;
  maskedDocumentText?: string;
  conversationContext?: string;
  routingDecision: RoutingDecision;
  sessionId: string;
  userId: string;
  username: string;
}

export interface OrchestrateOutput {
  assistantText: string;
  orchestrationMeta: OrchestrationMeta;
  // null if orchestrator opted out (task too simple for sub-agents)
  optedOut?: boolean;
}

/**
 * Run the full orchestration pipeline.
 * Returns the synthesized response + metadata, or null if the planner opted out.
 */
export async function orchestrate(
  input: OrchestrateInput,
  res: Response,
): Promise<OrchestrateOutput> {
  const startTime = Date.now();
  const { sessionId, userId, username } = input;

  // ─── Phase 1: Plan ───────────────────────────────────────────────────
  const plannerStart = Date.now();
  const plan = await runPlanner(input.originalPrompt, input.conversationContext);
  const plannerDurationMs = Date.now() - plannerStart;

  // Log planner LLM call (qwen3-32b) — fire-and-forget
  auditService.log({
    timestamp: new Date().toISOString(),
    userId,
    username,
    modelId: 'qwen.qwen3-32b-v1:0',
    inputTokens: Math.ceil(input.originalPrompt.length / 4),
    outputTokens: plan ? Math.ceil(JSON.stringify(plan).length / 4) : 0,
    status: plan ? 'success' : 'failed',
    durationMs: plannerDurationMs,
    sessionId,
  }).catch(() => {});

  // Opt-out gate: empty specs or single spec → fall back to single-shot
  // A single sub-agent with full orchestration (planner + execute + synthesis)
  // is strictly slower than direct generate() — adds 30-70s overhead for no benefit.
  if (!plan || !plan.specs || plan.specs.length <= 1) {
    const reason = !plan || !plan.specs || plan.specs.length === 0
      ? 'empty specs'
      : 'single spec (orchestration overhead > benefit)';
    console.log(`[orchestrator] Planner opted out — ${reason}, falling back to single-shot`);
    return {
      assistantText: '',
      optedOut: true,
      orchestrationMeta: {
        specs: plan?.specs ?? [],
        results: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        plannerDurationMs,
        executeDurationMs: 0,
        synthesisDurationMs: 0,
        synthesizeUsed: false,
        summarizeTriggered: false,
      },
    };
  }

  // Emit orchestration_plan SSE event
  res.write(`event: orchestration_plan\ndata: ${JSON.stringify({
    specs: plan.specs,
    reasoning: plan.reasoning,
  })}\n\n`);

  console.log(`[orchestrator] Plan: ${plan.specs.length} sub-agents — ${plan.reasoning}`);

  // ─── Phase 1b: Context Injection ─────────────────────────────────────
  const enrichedSpecs = injectContext(
    plan.specs,
    input.originalPrompt,
    input.maskedDocumentText,
    input.conversationContext,
  );

  // ─── Phase 2: Execute ────────────────────────────────────────────────
  const executeStart = Date.now();
  const results = await executeAll(enrichedSpecs, res, sessionId, userId, username);
  const executeDurationMs = Date.now() - executeStart;

  const successResults = results.filter(r => r.status === 'success');
  console.log(`[orchestrator] Execution complete: ${successResults.length}/${results.length} agents succeeded`);

  // ─── Phase 3: Synthesize ─────────────────────────────────────────────
  const synthesisStart = Date.now();
  const synthesisResult = await synthesize(plan.specs, results, res, sessionId, userId, username);
  const synthesisDurationMs = Date.now() - synthesisStart;

  const totalDurationMs = Date.now() - startTime;
  console.log(`[orchestrator] Synthesis complete in ${totalDurationMs}ms (plan=${plannerDurationMs}ms exec=${executeDurationMs}ms synth=${synthesisDurationMs}ms)`);

  // ─── Build orchestration meta for audit ─────────────────────────────
  const orchestrationMeta: OrchestrationMeta = {
    specs: enrichedSpecs,
    results,
    totalInputTokens: results.reduce((sum, r) => sum + r.inputTokens, 0) + synthesisResult.inputTokens,
    totalOutputTokens: results.reduce((sum, r) => sum + r.outputTokens, 0) + synthesisResult.outputTokens,
    plannerDurationMs,
    executeDurationMs,
    synthesisDurationMs,
    synthesizeUsed: true,
    summarizeTriggered: synthesisResult.summarizeTriggered,
  };

  return {
    assistantText: synthesisResult.text,
    orchestrationMeta,
  };
}

// ─── Planner ──────────────────────────────────────────────────────────────

interface PlannerOutput {
  specs: SubAgentSpec[];
  reasoning: string;
}

/**
 * Call the Planner LLM (qwen3-32b) to decompose the task.
 * Returns null on failure.
 */
async function runPlanner(
  prompt: string,
  conversationContext?: string,
): Promise<PlannerOutput | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const contextBlock = conversationContext
      ? `\n\nConversation context (previous user messages):\n${conversationContext}`
      : '';

    const userPrompt = [
      `User request: ${prompt}${contextBlock}`,
      '',
      'Decide: does this need parallel sub-agents? If yes, output specs. If not, output empty array.',
    ].join('\n');

    const command = new ConverseCommand({
      modelId: 'qwen.qwen3-32b-v1:0',
      system: [{ text: SUBAGENT_PLANNER_SYSTEM_PROMPT }],
      messages: [{ role: 'user', content: [{ text: userPrompt }] }],
      inferenceConfig: { maxTokens: 2048, temperature: 0.1 },
    });

    const response = await bedrockClient.send(command, {
      abortSignal: controller.signal,
    });

    const rawText = response.output?.message?.content?.[0]?.text?.trim();
    if (!rawText) return null;

    // Parse JSON output
    const cleaned = rawText
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);

    if (!parsed || !Array.isArray(parsed.specs)) {
      console.warn('[orchestrator] Planner returned invalid format — missing specs array');
      return null;
    }

    return {
      specs: parsed.specs as SubAgentSpec[],
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      console.warn('[orchestrator] Planner returned invalid JSON');
    } else {
      console.warn('[orchestrator] Planner LLM call failed:', (error as Error).message);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Context Injection ────────────────────────────────────────────────────

/**
 * Inject XML-tagged document text + conversation history into each spec's prompt.
 * Keeps planner's base instruction separate from reference material.
 */
function injectContext(
  specs: SubAgentSpec[],
  originalPrompt: string,
  maskedDocumentText?: string,
  conversationContext?: string,
): SubAgentSpec[] {
  return specs.map(spec => {
    const parts: string[] = [spec.prompt];

    if (maskedDocumentText) {
      parts.push('', '<document_context>', maskedDocumentText, '</document_context>');
    }

    if (conversationContext) {
      parts.push('', '<conversation_context>', conversationContext, '</conversation_context>');
    }

    return {
      ...spec,
      prompt: parts.join('\n'),
    };
  });
}
