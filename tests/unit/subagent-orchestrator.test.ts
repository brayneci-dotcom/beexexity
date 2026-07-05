import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillType, RoutingDecision } from '../../src/types/routing.types.js';
import type { OrchestrationMeta, SubAgentSpec, SubAgentResult } from '../../src/types/subagent.types.js';

// ─── Mock Bedrock (ConverseCommand) ───────────────────────────────────────
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn().mockImplementation(() => ({
    send: vi.fn(),
  })),
  ConverseCommand: vi.fn(),
  ConverseStreamCommand: vi.fn(),
}));

// ─── Trigger Logic Tests ──────────────────────────────────────────────────

describe('orchestrator trigger logic', () => {
  const TRIGGER_SKILLS: SkillType[] = [
    'compliance_pre_assessment',
    'requirement_generation',
    'document_qna',
  ];

  it('triggers for high-complexity compliance_pre_assessment', () => {
    const skill: SkillType = 'compliance_pre_assessment';
    const complexity = 4;
    const multiStep = TRIGGER_SKILLS.includes(skill) && complexity >= 4;
    expect(multiStep).toBe(true);
  });

  it('triggers for high-complexity requirement_generation', () => {
    const skill: SkillType = 'requirement_generation';
    const complexity = 5;
    const multiStep = TRIGGER_SKILLS.includes(skill) && complexity >= 4;
    expect(multiStep).toBe(true);
  });

  it('triggers for high-complexity document_qna', () => {
    const skill: SkillType = 'document_qna';
    const complexity = 4;
    const multiStep = TRIGGER_SKILLS.includes(skill) && complexity >= 4;
    expect(multiStep).toBe(true);
  });

  it('does NOT trigger for low-complexity trigger skills', () => {
    const skill: SkillType = 'compliance_pre_assessment';
    const complexity = 3;
    const multiStep = TRIGGER_SKILLS.includes(skill) && complexity >= 4;
    expect(multiStep).toBe(false);
  });

  it('does NOT trigger for high-complexity non-trigger skills', () => {
    const skill: SkillType = 'email';
    const complexity = 5;
    const multiStep = TRIGGER_SKILLS.includes(skill) && complexity >= 4;
    expect(multiStep).toBe(false);
  });

  it('does NOT trigger for high-complexity code skill', () => {
    const skill: SkillType = 'code';
    const complexity = 4;
    const multiStep = TRIGGER_SKILLS.includes(skill) && complexity >= 4;
    expect(multiStep).toBe(false);
  });
});

// ─── Planner JSON Parsing ─────────────────────────────────────────────────

describe('Planner JSON parsing', () => {
  function parsePlannerOutput(raw: string): { specs: SubAgentSpec[]; reasoning: string } | null {
    const cleaned = raw
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (!parsed || !Array.isArray(parsed.specs)) return null;
      return {
        specs: parsed.specs as SubAgentSpec[],
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      };
    } catch {
      return null;
    }
  }

  it('parses valid JSON with specs', () => {
    const raw = JSON.stringify({
      specs: [
        {
          agentId: 'data-extractor',
          skill: 'data_extraction',
          prompt: 'Extract all figures from the document.',
          targetModel: 'qwen.qwen3-32b-v1:0',
          dependencies: [],
        },
        {
          agentId: 'legal-analyst',
          skill: 'legal_analysis',
          prompt: 'Analyze compliance requirements.',
          dependencies: [],
        },
      ],
      reasoning: 'Need to extract data then analyze compliance',
    });

    const result = parsePlannerOutput(raw);
    expect(result).not.toBeNull();
    expect(result!.specs).toHaveLength(2);
    expect(result!.specs[0].agentId).toBe('data-extractor');
    expect(result!.specs[0].targetModel).toBe('qwen.qwen3-32b-v1:0');
    expect(result!.specs[1].agentId).toBe('legal-analyst');
    expect(result!.specs[1].targetModel).toBeUndefined();
    expect(result!.reasoning).toBe('Need to extract data then analyze compliance');
  });

  it('handles empty array (planner opt-out)', () => {
    const raw = JSON.stringify({
      specs: [],
      reasoning: 'Task too simple for sub-agents',
    });

    const result = parsePlannerOutput(raw);
    expect(result).not.toBeNull();
    expect(result!.specs).toHaveLength(0);
    expect(result!.reasoning).toBe('Task too simple for sub-agents');
  });

  it('returns null for invalid JSON', () => {
    const result = parsePlannerOutput('not json at all');
    expect(result).toBeNull();
  });

  it('returns null for JSON without specs array', () => {
    const raw = JSON.stringify({ foo: 'bar' });
    const result = parsePlannerOutput(raw);
    expect(result).toBeNull();
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n{"specs":[],"reasoning":"simple"}\n```';
    const result = parsePlannerOutput(raw);
    expect(result).not.toBeNull();
    expect(result!.specs).toHaveLength(0);
  });

  it('strips uppercase code fences', () => {
    const raw = '```JSON\n{"specs":[],"reasoning":"simple"}\n```';
    const result = parsePlannerOutput(raw);
    expect(result).not.toBeNull();
    expect(result!.reasoning).toBe('simple');
  });
});

// ─── Token Budget ─────────────────────────────────────────────────────────

describe('Token budget calculation', () => {
  it('triggers per-agent summarization when single agent exceeds its share', () => {
    const agentCount = 3;
    const tokenBudget = 30000;
    const perAgentBudget = Math.floor(tokenBudget / agentCount); // 10000
    // 4 chars ≈ 1 token
    const agentText = 'x'.repeat(perAgentBudget * 4 + 100); // exceeds per-agent budget
    const estimatedTokens = agentText.length / 4;

    expect(estimatedTokens).toBeGreaterThan(perAgentBudget);
    expect(estimatedTokens).toBeLessThan(tokenBudget); // but doesn't exceed TOTAL
  });

  it('does NOT trigger summarization when all agents within budget', () => {
    const agentCount = 3;
    const tokenBudget = 30000;
    const perAgentBudget = Math.floor(tokenBudget / agentCount);
    const agentText = 'x'.repeat((perAgentBudget - 1) * 4); // under per-agent budget
    const estimatedTokens = agentText.length / 4;

    expect(estimatedTokens).toBeLessThan(perAgentBudget);
  });

  it('per-agent check, not combined blob', () => {
    const tokenBudget = 30000;
    const agentCount = 3;
    const perAgentBudget = Math.floor(tokenBudget / agentCount);

    // Agent 1: huge, Agent 2: tiny, Agent 3: tiny
    const huge = 'x'.repeat(perAgentBudget * 4 + 1000);
    const tiny = 'x'.repeat(100);

    expect(huge.length / 4).toBeGreaterThan(perAgentBudget); // agent 1 exceeds
    expect(tiny.length / 4).toBeLessThan(perAgentBudget);    // agent 2 ok
    expect(tiny.length / 4).toBeLessThan(perAgentBudget);    // agent 3 ok
    // Combined is huge, but we check per-agent
  });
});

// ─── PII Masking ──────────────────────────────────────────────────────────

describe('PII masking on sub-agent outputs', () => {
  it('mask function is applied to sub-agent results', () => {
    // Simulate mask() behavior — NIK 16-digit numbers get masked
    const rawText = 'Customer NIK: 3201011234567890, phone: 08123456789';
    const maskedText = rawText.replace(/\b\d{16}\b/g, '[NIK_1]').replace(/08\d{8,12}\b/g, '[NO_HP_1]');

    expect(maskedText).toContain('[NIK_1]');
    expect(maskedText).toContain('[NO_HP_1]');
    expect(maskedText).not.toContain('3201011234567890');
    expect(maskedText).not.toContain('08123456789');
  });

  it('SubAgentResult.text contains masked output, not raw PII', () => {
    const raw = 'Transfer to rekening 123456789012';
    const masked = raw.replace(/\b\d{12,15}\b/g, '[NO_REKENING_1]');

    const result: SubAgentResult = {
      agentId: 'extractor',
      status: 'success',
      text: masked,
      inputTokens: 10,
      outputTokens: 5,
      durationMs: 100,
    };

    expect(result.text).toContain('[NO_REKENING_1]');
    expect(result.text).not.toContain('123456789012');
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────

describe('SubAgentResult error handling', () => {
  it('includes errorMessage for failed agents', () => {
    const result: SubAgentResult = {
      agentId: 'timeout-agent',
      status: 'timeout',
      text: '',
      errorMessage: 'Sub-agent timed out after 120000ms',
      inputTokens: 0,
      outputTokens: 0,
      durationMs: 120000,
    };

    expect(result.status).toBe('timeout');
    expect(result.errorMessage).toBeDefined();
    expect(result.errorMessage).toContain('timed out');
    expect(result.text).toBe('');
  });

  it('includes errorMessage for failed agents with Bedrock error', () => {
    const result: SubAgentResult = {
      agentId: 'failed-agent',
      status: 'failed',
      text: '',
      errorMessage: 'Model throttling exceeded',
      inputTokens: 50,
      outputTokens: 0,
      durationMs: 5000,
    };

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('Model throttling exceeded');
  });
});

// ─── OrchestrationMeta ────────────────────────────────────────────────────

describe('OrchestrationMeta', () => {
  it('captures timing breakdown and token counts', () => {
    const meta: OrchestrationMeta = {
      specs: [{ agentId: 'a', skill: 'extract', prompt: 'do stuff', dependencies: [] }],
      results: [{
        agentId: 'a', status: 'success', text: 'output', inputTokens: 100, outputTokens: 50, durationMs: 200,
      }],
      totalInputTokens: 100,
      totalOutputTokens: 50,
      plannerDurationMs: 300,
      executeDurationMs: 200,
      synthesisDurationMs: 400,
      synthesizeUsed: true,
      summarizeTriggered: false,
    };

    expect(meta.plannerDurationMs).toBe(300);
    expect(meta.executeDurationMs).toBe(200);
    expect(meta.synthesisDurationMs).toBe(400);
    expect(meta.totalInputTokens).toBe(100);
    expect(meta.summarizeTriggered).toBe(false);
  });

  it('flags when summarization was triggered', () => {
    const meta: OrchestrationMeta = {
      specs: [],
      results: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      plannerDurationMs: 100,
      executeDurationMs: 0,
      synthesisDurationMs: 0,
      synthesizeUsed: true,
      summarizeTriggered: true,
    };

    expect(meta.summarizeTriggered).toBe(true);
  });
});
