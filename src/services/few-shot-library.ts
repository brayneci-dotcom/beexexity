/**
 * Few-Shot Library — golden examples for format adherence per skill.
 *
 * Each skill gets 1-2 user/assistant example pairs that demonstrate the
 * expected output format. Injected before the current user prompt so the
 * inference model sees the format pattern before responding.
 *
 * Skills without entries get zero-shot instructions only (existing behavior).
 *
 * @see Requirements 4.x, 7.x
 */

import type { BedrockMessage } from '../types/session.types.js';
import type { SkillType } from '../types/routing.types.js';

// ─── Types ───────────────────────────────────────────────────────────────────────

export interface FewShotEntry {
  user: string;
  assistant: string;
}

// ─── Library ─────────────────────────────────────────────────────────────────────

const FEW_SHOTS: Partial<Record<SkillType, FewShotEntry[]>> = {
  // ── Generation ──────────────────────────────────────────────────────────

  business_writing: [
    {
      user: 'draft a {type} for {recipient} about {topic}',
      assistant:
        'Subject: {subject_line}\n\nDear {recipient},\n\n{body}\n\nBest regards,\n[Your Name]',
    },
  ],
  creative_writing: [
    {
      user: 'write a {genre} piece about {topic}',
      assistant:
        '{creative_piece_output}',
    },
  ],
  prompt_optimizer: [],  // Zero-shot — refinement prompt handles prompt engineering

  brainstorming: [
    {
      user: 'ideas for {topic}',
      assistant:
        'Here are several ideas for {topic}:\n\n1. **{Idea 1}**: {Description}\n2. **{Idea 2}**: {Description}\n3. **{Idea 3}**: {Description}\n4. **{Idea 4}**: {Description}\n5. **{Idea 5}**: {Description}',
    },
  ],

  // ── Transformation ──────────────────────────────────────────────────────

  summarization: [
    {
      user: 'summarize this: {source_text}',
      assistant:
        '**Summary**\n\n- Key point 1\n- Key point 2\n- Key point 3\n- Key point 4',
    },
  ],

  translation: [],  // Empty — refinement prompt + global rules handle translation. Few-shot caused contamination (model regurgitated example content).

  data_transformation: [
    {
      user: 'convert this {format}: {source_data}',
      assistant:
        '{target_format_output}',
    },
  ],

  editing: [
    {
      user: 'improve this {text_type}: "{original_text}"',
      assistant:
        '**Original**: {original_text}\n\n**Revised**: {revised_text}\n\n**Changes**:\n- {change_1}\n- {change_2}\n- {change_3}',
    },
  ],

  // ── Engineering ─────────────────────────────────────────────────────────

  code: [
    {
      user: 'write a {function_name} to {task_description}',
      assistant:
        '```{language}\n{code_snippet}\n```\n\nThis function:\n- {behavior_1}\n- {behavior_2}\n- {behavior_3}',
    },
  ],

  // ── Enterprise ──────────────────────────────────────────────────────────

  compliance_pre_assessment: [
    {
      user: 'assess this for {regulation} compliance: {scenario_description}',
      assistant:
        '## {Regulation} Compliance Pre-Assessment\n\n**Scope**: {scope}\n\n**Risk Level**: {risk_level}\n\n**Findings:**\n\n| Area | Status | Notes |\n|---|---|---|\n| {Area 1} | ✅ {status} | {notes} |\n| {Area 2} | ⚠️ {status} | {notes} |\n| {Area 3} | ❌ {status} | {notes} |\n\n**Recommendations:**\n1. {recommendation_1}\n2. {recommendation_2}\n3. {recommendation_3}',
    },
  ],

  risk_analyst: [
    {
      user: 'assess risk for {scenario_or_asset}',
      assistant:
        '## Risk Assessment: {Title}\n\n**Risk Score**: {likelihood}/{impact}\n\n**Identified Risks:**\n- {Risk 1}: {description} (Mitigation: {mitigation})\n- {Risk 2}: {description} (Mitigation: {mitigation})\n\n**Overall Rating**: {rating}',
    },
    {
      user: 'analisis risiko untuk {skenario_atau_aset}',
      assistant:
        '## Penilaian Risiko: {Judul}\n\n**Skor Risiko**: {kemungkinan}/{dampak}\n\n**Risiko Teridentifikasi:**\n- {Risiko 1}: {deskripsi} (Mitigasi: {mitigasi})\n- {Risiko 2}: {deskripsi} (Mitigasi: {mitigasi})\n\n**Rating Keseluruhan**: {rating}',
    },
  ],

  process_optimization: [
    {
      user: 'optimize our {process_name} process',
      assistant:
        '## Process Improvement: {Process}\n\n**Current State**: {as_is}\n\n**Bottlenecks**:\n- {bottleneck_1}\n- {bottleneck_2}\n\n**Recommendations**:\n1. {recommendation_1}\n2. {recommendation_2}\n\n**Expected Impact**: {impact}',
    },
    {
      user: 'optimalkan proses {nama_proses} kami',
      assistant:
        '## Perbaikan Proses: {Proses}\n\n**Kondisi Saat Ini**: {kondisi_sekarang}\n\n**Hambatan**:\n- {hambatan_1}\n- {hambatan_2}\n\n**Rekomendasi**:\n1. {rekomendasi_1}\n2. {rekomendasi_2}\n\n**Dampak yang Diharapkan**: {dampak}',
    },
  ],

  data_analysis: [
    {
      user: 'analyze this data: {dataset_description}',
      assistant:
        '## Data Analysis: {Title}\n\n**Summary**: {overview}\n\n**Key Findings**:\n- {finding_1}\n- {finding_2}\n- {finding_3}\n\n**Insights**: {insights}',
    },
    {
      user: 'analisis data ini: {deskripsi_dataset}',
      assistant:
        '## Analisis Data: {Judul}\n\n**Ringkasan**: {gambaran_umum}\n\n**Temuan Utama**:\n- {temuan_1}\n- {temuan_2}\n- {temuan_3}\n\n**Insight**: {wawasan}',
    },
  ],
};

// ─── Public API ──────────────────────────────────────────────────────────────────

/**
 * Get few-shot example pairs for a given skill.
 * Returns an empty array if no examples exist for the skill (zero-shot fallback).
 */
export function getFewShotExamples(skill: SkillType): BedrockMessage[] {
  const entries = FEW_SHOTS[skill];
  if (!entries || entries.length === 0) return [];

  const pairs: BedrockMessage[] = [];
  for (const entry of entries) {
    pairs.push({ role: 'user', content: [{ text: entry.user }] });
    pairs.push({ role: 'assistant', content: [{ text: entry.assistant }] });
  }
  return pairs;
}
