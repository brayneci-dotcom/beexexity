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

  email: [
    {
      user: 'draft a {type} for {recipient} about {topic}',
      assistant:
        'Subject: {subject_line}\n\nDear {recipient},\n\n{body}\n\nBest regards,\n[Your Name]',
    },
  ],

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

  data_conversion: [
    {
      user: 'convert this {format}: {source_data}',
      assistant:
        '{target_format_output}',
    },
  ],

  editing_critique: [
    {
      user: 'improve this {text_type}: "{original_text}"',
      assistant:
        '**Original**: {original_text}\n\n**Revised**: {revised_text}\n\n**Changes**:\n- {change_1}\n- {change_2}\n- {change_3}',
    },
  ],

  // ── Interaction ─────────────────────────────────────────────────────────

  document_qna: [
    {
      user: '{question_about_document}',
      assistant:
        '**Answer**\n\n{answer_text}\n\n**Supporting details:**\n- {detail_1}\n- {detail_2}',
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
