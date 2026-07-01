/**
 * Routing Engine Service
 *
 * Performs prompt refinement, complexity scoring, and policy-based routing.
 * Uses qwen.qwen3-32b-v1:0 via Bedrock Converse (non-streaming) for both
 * refinement and scoring operations.
 *
 * Fallback strategy:
 * - Refinement failure → use original prompt + 'refinement-failed' flag
 * - Scoring failure → default score from config (2)
 * - Policy failure → fallback to qwen.qwen3-32b-v1:0
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.5, 6.1, 6.2, 6.3, 10.1, 10.2, 12.1, 12.2, 12.3, 12.4
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { config } from '../config/index.js';
import { resolvePolicy } from './routing-policy.service.js';
import type {
  RoutingInput,
  RoutingDecision,
  PolicyInput,
} from '../types/routing.types.js';
import type { ModalityFlags } from '../types/inference.types.js';

/** Bedrock client for routing engine calls (scoring + refinement). */
const bedrockClient = new BedrockRuntimeClient({
  region: config.aws.region,
});

/**
 * Refines the prompt using qwen.qwen3-32b-v1:0 via Bedrock Converse (non-streaming).
 * Structures the output into four sections: Role, Context, Task, Intent —
 * giving the downstream model a clear persona and framework for answering.
 * Returns the refined prompt or null on failure.
 */
export async function refinePrompt(
  originalPrompt: string,
  documentContext?: string
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, config.routing.refinementTimeoutMs);

  try {
    const systemPrompt = [
      'You are a prompt structuring assistant. Your job is to decompose the user\'s request into a structured prompt that helps a large language model give the best possible answer.',
      '',
      'Analyze the request and produce output in exactly these four sections:',
      '',
      '1. ROLE — The single best professional persona or expert role to answer this question (e.g. "Indonesian banking lawyer", "financial analyst", "tax consultant", "software architect"). Choose the most relevant domain expert.',
      '2. CONTEXT — Relevant background, domain knowledge, or situational framing the model needs to know. Infer reasonable context from the request; do not fabricate facts.',
      '3. TASK — The core task in one clear, actionable sentence. What exactly should the model produce? (e.g. "Explain the steps to...", "Compare X and Y...", "Draft a response to...")',
      '4. INTENT — The underlying goal or purpose. What does the user ultimately want to accomplish or decide? (e.g. "To make an informed investment decision", "To comply with OJK regulation")',
      '',
      'Rules:',
      '- Preserve the original intent exactly.',
      '- CRITICAL: Respond in the SAME LANGUAGE as the original request. If the user wrote in Bahasa Indonesia, the refined prompt must be in Bahasa Indonesia. If in English, respond in English. Match the language exactly.',
      '- Do NOT add facts that were not implied by the original request.',
      '- Do NOT include any personally identifiable information (PII).',
      '- The output prompt will be sent directly to the answering model, so make it self-contained.',
      '',
      'Output format (do not include the numbers or labels in the final prompt — write it as flowing text):',
      'You are a [role]. [Context paragraph]. Your task is to [task]. The goal is to [intent].',
      '(Write the entire output in the same language as the original request.)',
      '',
      'Now structure this request accordingly.',
    ].join('\n');

    const userContent = documentContext
      ? `Original request: ${originalPrompt}\n\nDocument context: ${documentContext}`
      : `Original request: ${originalPrompt}`;

    const command = new ConverseCommand({
      modelId: config.routing.scoringModelId,
      system: [{ text: systemPrompt }],
      messages: [
        {
          role: 'user',
          content: [{ text: userContent }],
        },
      ],
      inferenceConfig: {
        maxTokens: 1024,
        temperature: 0.3,
      },
    });

    const response = await bedrockClient.send(command, {
      abortSignal: controller.signal,
    });

    const outputText = response.output?.message?.content?.[0]?.text;
    if (!outputText || outputText.trim().length === 0) {
      return null;
    }

    return outputText.trim();
  } catch {
    // Any failure (timeout, API error, parse error) → return null
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Scores prompt complexity 1-5 using qwen.qwen3-32b-v1:0 via Bedrock Converse (non-streaming).
 * Returns score object or null on failure.
 */
export async function scoreComplexity(
  prompt: string,
  documentContext?: string,
  conversationContext?: string
): Promise<{ score: number; confidence: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, config.routing.scoringTimeoutMs);

  try {
    const systemPrompt = [
      'You are a complexity scoring assistant. Rate the complexity of the user\'s request on a scale of 1 to 5.',
      '',
      'Scoring guide:',
      '1 = Simple factual question or greeting',
      '2 = Straightforward task with clear answer',
      '3 = Moderate task requiring some reasoning',
      '4 = Complex task requiring multi-step reasoning or domain expertise',
      '5 = Highly complex task requiring advanced reasoning, synthesis, or creative problem-solving',
      '',
      'Also provide a confidence value between 0.0 and 1.0 indicating how confident you are in the score.',
      '',
      'Respond ONLY with a JSON object in this exact format:',
      '{"score": <integer 1-5>, "confidence": <float 0.0-1.0>}',
    ].join('\n');

    const userContentParts: string[] = [`Request: ${prompt}`];
    if (conversationContext) {
      userContentParts.push(`\nRecent conversation context: ${conversationContext}`);
    }
    if (documentContext) {
      userContentParts.push(`\nDocument context: ${documentContext}`);
    }
    const userContent = userContentParts.join('');

    const command = new ConverseCommand({
      modelId: config.routing.scoringModelId,
      system: [{ text: systemPrompt }],
      messages: [
        {
          role: 'user',
          content: [{ text: userContent }],
        },
      ],
      inferenceConfig: {
        maxTokens: 64,
        temperature: 0.1,
      },
    });

    const response = await bedrockClient.send(command, {
      abortSignal: controller.signal,
    });

    const outputText = response.output?.message?.content?.[0]?.text;
    if (!outputText) {
      return null;
    }

    // Parse JSON response — handle potential markdown code blocks
    const cleanedText = outputText.replace(/```json\s*|\s*```/g, '').trim();
    const parsed = JSON.parse(cleanedText);

    const score = Math.round(Number(parsed.score));
    const confidence = Number(parsed.confidence);

    // Validate score is in range 1-5
    if (isNaN(score) || score < 1 || score > 5) {
      return null;
    }

    // Validate confidence is in range 0-1
    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
      return { score, confidence: 0.5 }; // Default confidence if invalid
    }

    return { score, confidence };
  } catch {
    // Any failure (timeout, API error, parse error) → return null
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Maps a complexity score to its band name.
 * Complexity 1 → Qwen3 32B (simple, fast answers)
 * Complexity 2-3 → moderate (needs stronger model)
 * Complexity 4-5 → advanced (needs highest-capability model)
 */
function scoreToBand(score: number): 'direct-answer' | 'moderate-reasoning' | 'advanced-reasoning' {
  if (score <= 1) return 'direct-answer';
  if (score <= 3) return 'moderate-reasoning';
  return 'advanced-reasoning';
}

/**
 * Builds modality flags from routing input.
 */
function buildModalityFlags(input: RoutingInput): ModalityFlags {
  const hasDocument = !!input.maskedDocumentText;
  const hasImage = input.hasImages;

  return {
    textOnly: !hasDocument && !hasImage,
    documentText: hasDocument && !hasImage,
    image: hasImage && !hasDocument,
    mixed: hasDocument && hasImage,
  };
}

/**
 * Determines the modality description for the reasoning summary.
 */
function getModalityDescription(flags: ModalityFlags): string {
  if (flags.mixed) return 'mixed modality';
  if (flags.image) return 'image modality';
  if (flags.documentText) return 'document-text modality';
  return 'text-only modality';
}

/**
 * Main entry point for the routing engine.
 * Performs prompt refinement, complexity scoring, and policy-based routing.
 */
export async function routeRequest(input: RoutingInput): Promise<RoutingDecision> {
  const modalityFlags = buildModalityFlags(input);
  const flags: string[] = [];

  // Manual state: skip refinement/scoring, use policy with manual state
  if (input.routingState === 'manual') {
    const policyInput: PolicyInput = {
      complexityScore: config.routing.defaultFallbackScore,
      hasImages: input.hasImages,
      isLongContext: false,
      routingState: 'manual',
      manualModelId: input.manualModelId,
    };

    let policyResult;
    try {
      policyResult = resolvePolicy(policyInput);
    } catch {
      policyResult = { modelId: 'qwen.qwen3-32b-v1:0', reasonCode: 'routing-fallback' };
      flags.push('policy-failed');
    }

    return {
      executedModelId: policyResult.modelId,
      routingState: 'manual',
      complexityScore: config.routing.defaultFallbackScore,
      scoreBand: scoreToBand(config.routing.defaultFallbackScore),
      confidence: 1.0,
      refinedPrompt: input.originalPrompt,
      routingReasonCode: policyResult.reasonCode,
      reasoningSummary: `Manual routing: user selected model ${policyResult.modelId}, ${getModalityDescription(modalityFlags)}`,
      modalityFlags,
      manualOverrideApplied: true,
      flags,
    };
  }

  // Auto state: perform refinement → scoring → policy resolution
  let refinedPrompt: string = input.originalPrompt;
  let complexityScore: number = config.routing.defaultFallbackScore;
  let confidence: number = 0.5;

  // Step 1: Prompt refinement
  const refinementStart = Date.now();
  const refinementResult = await refinePrompt(input.originalPrompt, input.maskedDocumentText);
  const refinementDuration = Date.now() - refinementStart;
  if (refinementResult !== null) {
    refinedPrompt = refinementResult;
    console.log(`[routing] Prompt refinement succeeded in ${refinementDuration}ms`);
  } else {
    // Refinement failed: use original prompt and flag
    flags.push('refinement-failed');
    console.warn(`[routing] Prompt refinement failed after ${refinementDuration}ms, using original prompt`);
  }

  // Step 2: Complexity scoring (includes conversation context if available)
  const scoringStart = Date.now();
  const scoringResult = await scoreComplexity(refinedPrompt, input.maskedDocumentText, input.conversationContext);
  const scoringDuration = Date.now() - scoringStart;
  if (input.conversationContext) {
    console.log(`[routing] Conversation context included in scoring (${input.conversationContext.length} chars), reason=routing-context-enrichment`);
    flags.push('routing-context-used');
  }
  if (scoringResult !== null) {
    complexityScore = scoringResult.score;
    confidence = scoringResult.confidence;
    console.log(`[routing] Complexity scoring: score=${complexityScore}, confidence=${confidence} in ${scoringDuration}ms`);
  } else {
    // Scoring failed: use default score
    complexityScore = config.routing.defaultFallbackScore;
    confidence = 0.5;
    flags.push('scoring-failed');
    console.warn(`[routing] Complexity scoring failed after ${scoringDuration}ms, defaulting to score ${complexityScore}`);
  }

  // Step 3: Determine long context
  const totalInputLength = (input.originalPrompt?.length ?? 0) + (input.maskedDocumentText?.length ?? 0);
  const isLongContext = totalInputLength > config.routing.longContextThreshold;

  // Step 4: Build policy input and resolve
  const policyInput: PolicyInput = {
    complexityScore,
    hasImages: input.hasImages,
    isLongContext,
    routingState: 'auto',
  };

  let policyResult;
  try {
    policyResult = resolvePolicy(policyInput);
  } catch {
    // Policy failure: fallback to default model
    policyResult = { modelId: 'qwen.qwen3-32b-v1:0', reasonCode: 'routing-fallback' };
    flags.push('policy-failed');
  }

  // Step 5: Map score to band
  const scoreBand = scoreToBand(complexityScore);

  // Step 6: Generate reasoning summary
  const reasoningParts = [`Auto-routed: complexity band ${scoreBand}`];
  if (isLongContext) {
    reasoningParts.push('long-context override');
  }
  reasoningParts.push(getModalityDescription(modalityFlags));
  if (flags.length > 0) {
    reasoningParts.push(`flags: [${flags.join(', ')}]`);
  }
  const reasoningSummary = reasoningParts.join(', ');

  // Step 7: Return complete routing decision
  return {
    executedModelId: policyResult.modelId,
    routingState: 'auto',
    complexityScore,
    scoreBand,
    confidence,
    refinedPrompt,
    routingReasonCode: policyResult.reasonCode,
    reasoningSummary,
    modalityFlags,
    manualOverrideApplied: false,
    flags,
  };
}

/** Exposed for testing — allows injecting a mock Bedrock client. */
export function _setBedrockClient(client: BedrockRuntimeClient): void {
  Object.assign(bedrockClient, client);
}

/** Exposed for testing. */
export { bedrockClient as _bedrockClient };
