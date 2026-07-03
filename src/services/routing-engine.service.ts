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
import { SkillType, ALL_SKILLS } from '../types/routing.types.js';
import type { PromptContract, VerificationResult } from '../types/routing.types.js';
import type { ModalityFlags } from '../types/inference.types.js';

/** Bedrock client for routing engine calls (scoring + refinement). */
const bedrockClient = new BedrockRuntimeClient({
  region: config.aws.region,
});

/**
 * Parses a JSON response from the refinement model and returns both a flowing
 * text prompt (backward compat) and a structured contract (for verification).
 * Handles markdown-wrapped JSON (```json ... ```).
 * Returns null flowingText if the response cannot be parsed.
 */
function parseRefinementContract(raw: string): {
  flowingText: string | null;
  contract: PromptContract | null;
} {
  // Strip markdown code fences if present
  let jsonStr = raw.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { flowingText: null, contract: null };
  }

  const role = typeof parsed.role === 'string' ? parsed.role.trim() : '';
  const context = typeof parsed.context === 'string' ? parsed.context.trim() : '';
  const task = typeof parsed.task === 'string' ? parsed.task.trim() : '';
  const intent = typeof parsed.intent === 'string' ? parsed.intent.trim() : '';
  const ambiguities = Array.isArray(parsed.ambiguities)
    ? parsed.ambiguities.filter((a): a is string => typeof a === 'string')
    : [];
  const clarificationNeeded = parsed.clarification_needed === true;

  // Build flowing text (unchanged — backward compat)
  const parts: string[] = [];
  if (role) parts.push(`You are a ${role}.`);
  if (context) parts.push(context);
  if (task) parts.push(`Your task is to ${task}.`);
  if (intent) parts.push(`The goal is to ${intent}.`);
  const flowingText = parts.length > 0 ? parts.join(' ') : null;

  // Build structured contract
  const contract: PromptContract = {
    role,
    context,
    task,
    intent,
    ambiguities,
    clarificationNeeded,
  };

  // Extract optional format hints from parsed fields
  if (typeof parsed.format === 'object' && parsed.format !== null) {
    const fmt = parsed.format as Record<string, unknown>;
    if (typeof fmt.type === 'string') {
      contract.format = { type: fmt.type };
      if (Array.isArray(fmt.mustInclude)) {
        contract.format.mustInclude = fmt.mustInclude.filter((s): s is string => typeof s === 'string');
      }
      if (Array.isArray(fmt.mustAvoid)) {
        contract.format.mustAvoid = fmt.mustAvoid.filter((s): s is string => typeof s === 'string');
      }
    }
  }
  if (Array.isArray(parsed.constraints)) {
    contract.constraints = parsed.constraints.filter((c): c is string => typeof c === 'string');
  }

  return { flowingText, contract };
}

/**
 * Extracts a skill tag from raw classifier output via substring match across
 * all 17 skill types. Returns 'general' if nothing matches.
 */
function extractSkill(raw: string): SkillType {
  const lower = raw.toLowerCase().trim();
  for (const skill of ALL_SKILLS) {
    if (lower.includes(skill)) return skill;
  }
  return 'general';
}

/**
 * Classifies the user's request into one of 17 skill categories.
 * Sends a lightweight LLM call — text-only, truncated to 1000 chars,
 * maxTokens 50, temperature 0. On any failure, returns 'general'.
 */
async function classifyRequestType(prompt: string): Promise<SkillType> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, config.routing.classifierTimeoutMs);

  try {
    // Truncate long text — classifier only needs first few sentences
    const truncated = prompt.length > 1000
      ? prompt.slice(0, 1000) + '...'
      : prompt;

    const systemPrompt = [
      'Classify the user request into ONE of these categories. Return ONLY the category name, no other text.',
      '',
      'Categories by group:',
      '[Generation] email | creative | brainstorming | meta_prompting',
      '[Transformation] summarization | translation | data_conversion | editing_critique',
      '[Interaction] roleplay | logic_math | planning_strategy | document_qna',
      '[Enterprise] requirement_generation | compliance_pre_assessment',
      '[Engineering] code | log_troubleshooting | general',
    ].join('\n');

    const command = new ConverseCommand({
      modelId: config.routing.scoringModelId,
      system: [{ text: systemPrompt }],
      messages: [{ role: 'user', content: [{ text: truncated }] }],
      inferenceConfig: {
        maxTokens: 50,
        temperature: 0,
      },
    });

    const response = await bedrockClient.send(command, {
      abortSignal: controller.signal,
    });

    const outputText = response.output?.message?.content?.[0]?.text;
    if (!outputText || outputText.trim().length === 0) {
      return 'general';
    }

    return extractSkill(outputText);
  } catch {
    return 'general';
  } finally {
    clearTimeout(timeout);
  }
}

/** Skill-specific refinement prompts. Keyed by SkillType. */
const SKILL_PROMPTS: Record<SkillType, string> = {
  // ── Generation ──────────────────────────────────────────────────
  email: [
    'You are an expert AI prompt engineer specializing in EMAIL WRITING.',
    'The user needs a concise email. Refine their request into structural JSON.',
    '',
    '### CRITICAL RULES:',
    '1. LANGUAGE PRESERVATION: Values MUST be in the EXACT SAME language as the input.',
    '2. JSON keys in English. Values in the detected language.',
    '3. BE EXTREMELY CONCISE. High signal, zero noise.',
    '4. JSON ONLY. No markdown, no explanations.',
    '',
    'Focus: sender/recipient relationship, formality level, greeting→body→CTA→closing.',
    '',
    '{ "role": "<email writer persona>", "context": "<situation>", "task": "<what to write>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  creative: [
    'You are an expert AI prompt engineer specializing in CREATIVE WRITING.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: audience, platform, tone, style guidance.',
    '',
    '{ "role": "<writer persona>", "context": "<audience/platform>", "task": "<creative piece>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  brainstorming: [
    'You are an expert AI prompt engineer specializing in IDEATION.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: creative domain, quantity of ideas, evaluation criteria.',
    '',
    '{ "role": "<creative strategist>", "context": "<domain/topic>", "task": "<generate ideas for>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  meta_prompting: [
    'You are an expert AI prompt engineer specializing in PROMPT ENGINEERING.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: target model, task type, input/output specification.',
    '',
    '{ "role": "<prompt engineer>", "context": "<target model/task>", "task": "<create a prompt for>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  // ── Transformation ──────────────────────────────────────────────
  summarization: [
    'You are an expert AI prompt engineer specializing in SUMMARIZATION.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: source type, target length, key facts to preserve.',
    '',
    '{ "role": "<editor/researcher>", "context": "<source type>", "task": "<summarize to N paragraphs>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  translation: [
    'You are an expert AI prompt engineer specializing in TRANSLATION.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: source→target language pair, domain (legal/technical/general), terminology.',
    '',
    '{ "role": "<translator>", "context": "<lang pair, domain>", "task": "<translate text>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  data_conversion: [
    'You are an expert AI prompt engineer specializing in DATA TRANSFORMATION.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: source format, target format, schema, validation rules.',
    '',
    '{ "role": "<data engineer>", "context": "<source→target format>", "task": "<convert data>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  editing_critique: [
    'You are an expert AI prompt engineer specializing in EDITING AND PROOFREADING.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: document type, style guide, specific issues to check.',
    '',
    '{ "role": "<editor/proofreader>", "context": "<document type>", "task": "<edit/critique>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  // ── Interaction ─────────────────────────────────────────────────
  roleplay: [
    'You are an expert AI prompt engineer specializing in ROLEPLAY AND SIMULATION.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: character/scenario, interaction rules, output format.',
    '',
    '{ "role": "<character role>", "context": "<scenario/setting>", "task": "<roleplay/respond as>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  logic_math: [
    'You are an expert AI prompt engineer specializing in LOGICAL REASONING AND MATHEMATICS.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: problem type, known variables, expected output.',
    '',
    '{ "role": "<mathematician/logician>", "context": "<problem domain>", "task": "<solve/compute>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  planning_strategy: [
    'You are an expert AI prompt engineer specializing in PLANNING AND STRATEGY.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: scope, constraints, timeline, deliverables.',
    '',
    '{ "role": "<strategist/planner>", "context": "<domain/scope>", "task": "<create plan/strategy for>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  document_qna: [
    'You are an expert AI prompt engineer specializing in DOCUMENT ANALYSIS.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: document type, specific questions, analysis depth.',
    '',
    '{ "role": "<document analyst>", "context": "<document type>", "task": "<analyze/answer questions about document>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  // ── Enterprise ──────────────────────────────────────────────────
  requirement_generation: [
    'You are an expert AI prompt engineer specializing in REQUIREMENTS ENGINEERING.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: stakeholder, feature scope, acceptance criteria, constraints.',
    '',
    '{ "role": "<business analyst>", "context": "<feature/domain>", "task": "<generate requirements for>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  compliance_pre_assessment: [
    'You are an expert AI prompt engineer specializing in REGULATORY COMPLIANCE.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: applicable regulations (OJK/BI/POJK), jurisdiction, risk assessment.',
    '',
    '{ "role": "<compliance officer>", "context": "<regulation/jurisdiction>", "task": "<assess compliance of>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  // ── Engineering ─────────────────────────────────────────────────
  code: [
    'You are an expert AI prompt engineer specializing in SOFTWARE DEVELOPMENT.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: language, framework, dependencies, testing expectations.',
    '',
    '{ "role": "<software engineer>", "context": "<language/framework>", "task": "<write code to>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  log_troubleshooting: [
    'You are an expert AI prompt engineer specializing in TROUBLESHOOTING.',
    'Refine the request into structural JSON.',
    '',
    'RULES: Language preservation. JSON keys English, values in detected language. Concise. JSON only.',
    '',
    'Focus: system context, error patterns, root cause analysis.',
    '',
    '{ "role": "<SRE/DevOps>", "context": "<system/stack>", "task": "<troubleshoot/debug>", "intent": "<...>", "ambiguities": ["<what is unclear>"], "clarification_needed": false }',
  ].join('\n'),

  // ── General (catch-all, unchanged from original) ─────────────────
  general: [
    'You are an expert AI prompt engineer. Your task is to refine the user\'s raw input into a strict, highly effective, and CONCISE structural prompt format.',
    '',
    '### CRITICAL RULES:',
    '1. LANGUAGE PRESERVATION: Detect the language of the original input. The refined prompt values MUST be in that EXACT SAME language. Do NOT translate to English.',
    '2. STRUCTURAL KEYS: Keep JSON keys in English. ONLY values in the detected language.',
    '3. BE EXTREMELY CONCISE:',
    '   - Do not add unnecessary context or hallucinate details.',
    '   - Avoid filler words and verbose phrasing. High signal, zero noise.',
    '   - Keep each field as short as possible.',
    '4. JSON ONLY: Output strictly valid JSON. No markdown, no explanations.',
    '',
    '### OUTPUT SCHEMA (use exactly these keys):',
    '{',
    '  "role": "<single best professional persona or expert role, e.g. financial analyst, tax consultant, software architect>",',
    '  "context": "<relevant background or situational framing — infer only what the request implies, do not fabricate>",',
    '  "task": "<the core task in one clear, actionable sentence — what should the model produce?>",',
    '  "intent": "<the underlying goal — what does the user ultimately want to accomplish?>"',
    '}',
  ].join('\n'),
};

export async function refinePrompt(
  originalPrompt: string,
  documentContext?: string,
  skill: SkillType = 'general',
): Promise<{ flowingText: string | null; contract: PromptContract | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, config.routing.refinementTimeoutMs);

  try {
    const systemPrompt = SKILL_PROMPTS[skill];

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
      return { flowingText: null, contract: null };
    }

    // Parse JSON and return both flowing text + structured contract
    return parseRefinementContract(outputText);
  } catch {
    // Any failure (timeout, API error, parse error) → return null
    return { flowingText: null, contract: null };
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
  conversationContext?: string,
  skill: SkillType = 'general',
): Promise<{ score: number; confidence: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, config.routing.scoringTimeoutMs);

  try {
    const systemPrompt = [
      'You are a complexity scoring assistant. Rate the complexity of the user\'s request on a scale of 1 to 5.',
      '',
      `The request has been classified as: "${skill}". Score relative to similar ${skill} tasks.`,
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
 * Deterministic verifier — checks assistant output against the prompt contract.
 * No LLM call. Returns structured verification result with pass/fail per check.
 */
export function verifyOutput(
  contract: PromptContract,
  assistantText: string,
): VerificationResult {
  const checks: VerificationResult['checks'] = [];
  const violations: VerificationResult['violations'] = [];

  // 1. Empty output check
  if (!assistantText || assistantText.trim().length === 0) {
    violations.push({ field: 'output', issue: 'Empty assistant response', severity: 'error' });
    checks.push({ name: 'Empty output', passed: false, detail: 'No text returned' });
    return { passed: false, violations, checks };
  }
  checks.push({ name: 'Empty output', passed: true, detail: `${assistantText.length} chars` });

  // 2. PII leakage check — placeholder residues
  const piiPattern = /\[(NIK|NO_HP|NO_REKENING|NAMA|NAMA_BANK)_\d+\]/g;
  const piiMatches = assistantText.match(piiPattern);
  if (piiMatches && piiMatches.length > 0) {
    violations.push({ field: 'pii', issue: `PII placeholders leaked: ${piiMatches.join(', ')}`, severity: 'error' });
    checks.push({ name: 'PII leakage', passed: false, detail: `${piiMatches.length} placeholders found` });
  } else {
    checks.push({ name: 'PII leakage', passed: true, detail: 'No placeholders' });
  }

  // 3. Word count check from contract constraints
  if (contract.constraints) {
    for (const constraint of contract.constraints) {
      const wordMatch = constraint.match(/under\s+(\d+)\s+words?/i);
      if (wordMatch) {
        const maxWords = parseInt(wordMatch[1], 10);
        const wordCount = assistantText.trim().split(/\s+/).length;
        if (wordCount > maxWords) {
          violations.push({
            field: 'constraints.wordCount',
            issue: `Word count exceeded: ${wordCount}/${maxWords}`,
            severity: 'warn',
          });
          checks.push({ name: 'Word count', passed: false, detail: `${wordCount}/${maxWords}` });
        } else {
          checks.push({ name: 'Word count', passed: true, detail: `${wordCount}/${maxWords}` });
        }
      }
    }
  }

  // 4. Required sections check from format.mustInclude
  if (contract.format?.mustInclude) {
    for (const section of contract.format.mustInclude) {
      const found = assistantText.toLowerCase().includes(section.toLowerCase());
      if (!found) {
        violations.push({
          field: `format.mustInclude.${section}`,
          issue: `Missing required section: "${section}"`,
          severity: 'error',
        });
      }
      checks.push({ name: `Required: ${section}`, passed: found, detail: found ? 'Present' : 'Missing' });
    }
  }

  // 5. Forbidden content check from format.mustAvoid
  if (contract.format?.mustAvoid) {
    for (const avoid of contract.format.mustAvoid) {
      const found = assistantText.toLowerCase().includes(avoid.toLowerCase());
      if (found) {
        violations.push({
          field: `format.mustAvoid.${avoid}`,
          issue: `Contains prohibited content: "${avoid}"`,
          severity: 'error',
        });
      }
      checks.push({ name: `Avoid: ${avoid}`, passed: !found, detail: found ? 'Found' : 'Absent' });
    }
  }

  const passed = violations.filter(v => v.severity === 'error').length === 0;
  return { passed, violations, checks };
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
      skill: 'general',
      contract: null,
    };
  }

  // Auto state: classify → refine → score → route
  let refinedPrompt: string = input.originalPrompt;
  let complexityScore: number = config.routing.defaultFallbackScore;
  let confidence: number = 0.5;
  let skill: SkillType = 'general';

  // Step 0: Classify request type (skip classifier for silent uploads)
  const hasEmptyPrompt = !input.originalPrompt.trim();
  if (hasEmptyPrompt && (input.hasImages || input.maskedDocumentText)) {
    // Silent upload — hardcode skill by content type, skip LLM call
    skill = 'document_qna';
    console.log('[routing] Silent upload detected — routing as document_qna');
  } else {
    // Normal: run classifier (text-only, truncated)
    const classificationStart = Date.now();
    skill = await classifyRequestType(input.originalPrompt);
    const classificationDuration = Date.now() - classificationStart;
    console.log(`[routing] Request classified as: ${skill} in ${classificationDuration}ms`);
  }

  // Step 1: Prompt refinement (skill-aware)
  const refinementStart = Date.now();
  const refinementResult = await refinePrompt(input.originalPrompt, input.maskedDocumentText, skill);
  const refinementDuration = Date.now() - refinementStart;
  let contract: PromptContract | null = null;
  if (refinementResult.flowingText !== null) {
    refinedPrompt = refinementResult.flowingText;
    contract = refinementResult.contract;
    console.log(`[routing] Prompt refinement (${skill}) succeeded in ${refinementDuration}ms`);
  } else {
    // Refinement failed: use original prompt and flag
    flags.push('refinement-failed');
    console.warn(`[routing] Prompt refinement failed after ${refinementDuration}ms, using original prompt`);
  }

  // Step 2: Complexity scoring (skill-calibrated, includes conversation context if available)
  const scoringStart = Date.now();
  const scoringResult = await scoreComplexity(refinedPrompt, input.maskedDocumentText, input.conversationContext, skill);
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
  const reasoningParts = [`skill=${skill} → complexity band ${scoreBand}`];
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
    skill,
    contract,
  };
}

/** Exposed for testing — allows injecting a mock Bedrock client. */
export function _setBedrockClient(client: BedrockRuntimeClient): void {
  Object.assign(bedrockClient, client);
}

/** Exposed for testing. */
export { bedrockClient as _bedrockClient };
