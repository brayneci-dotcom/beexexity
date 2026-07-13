/**
 * Tests for routing engine — validateSkillInvariants post-classification guard.
 */
import { describe, it, expect, vi } from 'vitest';
import type { RoutingInput } from '../../src/types/routing.types.js';
import { SkillType } from '../../src/types/routing.types.js';
import { _validateSkillInvariants } from '../../src/services/routing-engine.service.js';

// Mock Bedrock client to prevent actual AWS calls when importing
vi.mock('../../src/services/inference.service.js', () => ({
  bedrockClient: { send: vi.fn() },
  validateModelId: vi.fn((id: string) => id || 'qwen.qwen3-32b-v1:0'),
}));
vi.mock('../../src/services/pii-masker.service.js', () => ({
  mask: vi.fn((text: string) => ({ maskedText: text })),
}));
vi.mock('../../src/services/audit.service.js', () => ({
  auditService: { log: vi.fn().mockResolvedValue(undefined) },
}));

function makeInput(overrides?: Partial<RoutingInput>): RoutingInput {
  return {
    originalPrompt: 'test prompt',
    maskedDocumentText: undefined,
    hasImages: false,
    imageModelRequired: false,
    routingState: 'auto',
    userId: 'test-user',
    ...overrides,
  } as RoutingInput;
}

describe('validateSkillInvariants', () => {
  it('passes compliance_pre_assessment with legal context', () => {
    const input = makeInput({
      originalPrompt: 'evaluasi kepatuhan dokumen ini terhadap peraturan OJK',
      maskedDocumentText: 'Laporan keuangan tahunan 2025',
    });
    expect(_validateSkillInvariants('compliance_pre_assessment', input)).toBe('compliance_pre_assessment');
  });

  it('demotes compliance_pre_assessment without legal context', () => {
    const input = makeInput({
      originalPrompt: 'tell me a joke',
    });
    expect(_validateSkillInvariants('compliance_pre_assessment', input)).toBe('fallback');
  });

  it('passes risk_analyst with risk context', () => {
    const input = makeInput({
      originalPrompt: 'analisis risiko keamanan sistem pembayaran',
    });
    expect(_validateSkillInvariants('risk_analyst', input)).toBe('risk_analyst');
  });

  it('demotes risk_analyst without risk context', () => {
    const input = makeInput({
      originalPrompt: 'write a poem about the ocean',
    });
    expect(_validateSkillInvariants('risk_analyst', input)).toBe('fallback');
  });

  it('passes data_analysis with data context', () => {
    const input = makeInput({
      originalPrompt: 'analisis tren penjualan Q3 dari data ini',
      maskedDocumentText: 'monthly sales 2025.csv',
    });
    expect(_validateSkillInvariants('data_analysis', input)).toBe('data_analysis');
  });

  it('demotes data_analysis without data context', () => {
    const input = makeInput({
      originalPrompt: 'apa kabar?',
    });
    expect(_validateSkillInvariants('data_analysis', input)).toBe('fallback');
  });

  it('passes code with code blocks', () => {
    const input = makeInput({
      originalPrompt: '```\nconst x = 1;\n```\nreview this code',
    });
    expect(_validateSkillInvariants('code', input)).toBe('code');
  });

  it('passes code with code keywords', () => {
    const input = makeInput({
      originalPrompt: 'function calculateTotal() returns wrong result',
    });
    expect(_validateSkillInvariants('code', input)).toBe('code');
  });

  it('demotes code without code indicators', () => {
    const input = makeInput({
      originalPrompt: 'what is the meaning of life?',
    });
    expect(_validateSkillInvariants('code', input)).toBe('fallback');
  });

  it('passes process_optimization with process context', () => {
    const input = makeInput({
      originalPrompt: 'optimalkan alur kerja pengajuan kredit kami',
    });
    expect(_validateSkillInvariants('process_optimization', input)).toBe('process_optimization');
  });

  it('demotes process_optimization without process context', () => {
    const input = makeInput({
      originalPrompt: 'recommend a good restaurant',
    });
    expect(_validateSkillInvariants('process_optimization', input)).toBe('fallback');
  });

  it('passes through non-guarded skills unchanged', () => {
    const input = makeInput({ originalPrompt: 'draft an email' });
    expect(_validateSkillInvariants('business_writing', input)).toBe('business_writing');
    expect(_validateSkillInvariants('summarization', input)).toBe('summarization');
    expect(_validateSkillInvariants('fallback', input)).toBe('fallback');
  });
});
