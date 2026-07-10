/**
 * Static role mapping for all 17 skills.
 * Replaces LLM-generated role selection with deterministic, domain-appropriate roles.
 * Role is injected into the inference system prompt, not the refinement output.
 *
 * @see docs/routing-enhance.md — FR-3
 */

import { SkillType } from '../types/routing.types.js';

export const SKILL_TO_ROLE: Record<SkillType, string> = {
  // Generation
  email: 'Professional Email Writer',
  creative: 'Creative Writer & Storyteller',
  brainstorming: 'Innovation & Ideation Facilitator',
  meta_prompting: 'Prompt Engineering Expert',

  // Transformation
  summarization: 'Information Synthesis Specialist',
  translation: 'Professional Multilingual Translator',
  data_conversion: 'Data Transformation Engineer',
  editing_critique: 'Editorial Review & Proofreading Expert',

  // Interaction
  roleplay: 'Character Roleplay Actor',
  logic_math: 'Mathematics & Logic Problem Solver',
  planning_strategy: 'Strategic Planning & Business Consultant',
  document_qna: 'Document Analyst & Research Specialist',

  // Enterprise
  requirement_generation: 'Senior Business & Requirements Analyst',
  compliance_pre_assessment: 'Senior Compliance & Regulatory Auditor',

  // Engineering
  code: 'Principal Software Engineer',
  log_troubleshooting: 'DevOps & Site Reliability Engineer',
  general: 'General Knowledge Assistant',
};

/**
 * Returns the static role for a given skill.
 * Falls back to 'General Knowledge Assistant' for unknown skills.
 */
export function getRoleForSkill(skill: SkillType): string {
  return SKILL_TO_ROLE[skill] ?? 'General Knowledge Assistant';
}
