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
      user: 'draft a meeting reminder for tomorrow at 10am',
      assistant:
        'Subject: Meeting Reminder — Tomorrow 10:00 AM\n\nHi Team,\n\nJust a quick reminder about our meeting tomorrow at 10:00 AM. Please come prepared with your weekly updates.\n\nBest,\n[Your Name]',
    },
  ],

  brainstorming: [
    {
      user: 'ideas for improving customer onboarding',
      assistant:
        'Here are several ideas for improving customer onboarding:\n\n1. **Welcome Sequence**: Send a 3-email drip over the first week\n2. **Interactive Tutorial**: In-app walkthrough for key features\n3. **Personalized Setup**: Let users pick their goals on signup\n4. **Quick Wins**: Highlight the most valuable action on day 1\n5. **Feedback Loop**: Ask "what almost made you leave?" after week 1',
    },
  ],

  // ── Transformation ──────────────────────────────────────────────────────

  summarization: [
    {
      user: 'summarize this: The Q3 results show revenue grew 12% to 50M IDR. Operating costs increased 8% due to infrastructure upgrades. Net profit margin improved to 18%. The board approved a 5B IDR budget for Q4 expansion.',
      assistant:
        '**Q3 Financial Summary**\n\n- Revenue: 50M IDR (+12% YoY)\n- Operating costs: +8% (infrastructure upgrades)\n- Net profit margin: 18% (improved)\n- Q4 outlook: 5B IDR expansion budget approved',
    },
  ],

  translation: [
    {
      user: 'translate to Indonesian: The system will be deployed to production next week.',
      assistant:
        'Sistem akan digunakan ke produksi minggu depan.',
    },
  ],

  data_conversion: [
    {
      user: 'convert this JSON to CSV: {"users":[{"name":"Alice","age":30,"role":"Engineer"},{"name":"Bob","age":25,"role":"Designer"}]}',
      assistant:
        'name,age,role\nAlice,30,Engineer\nBob,25,Designer',
    },
  ],

  editing_critique: [
    {
      user: 'improve this sentence: "The system, which is very good, was implemented by the team who worked hard."',
      assistant:
        '**Original**: The system, which is very good, was implemented by the team who worked hard.\n\n**Revised**: The team implemented a robust system through dedicated effort.\n\n**Changes**:\n- Removed unnecessary clause ("which is very good")\n- Changed passive to active voice\n- Replaced "worked hard" with "dedicated effort" for formality',
    },
  ],

  // ── Interaction ─────────────────────────────────────────────────────────

  document_qna: [
    {
      user: 'what does section 3 say about data retention?',
      assistant:
        '**Section 3: Data Retention**\n\nSection 3 states that personal data will be retained for a maximum of 5 years after the end of the business relationship. After this period, all data must be securely deleted or anonymized.\n\n**Key requirements:**\n- Retention period: 5 years max\n- Action after period: Secure deletion or anonymization\n- Applies to: All personal data collected during the business relationship',
    },
  ],

  // ── Engineering ─────────────────────────────────────────────────────────

  code: [
    {
      user: 'write a function to validate email format in TypeScript',
      assistant:
        '```typescript\nfunction isValidEmail(email: string): boolean {\n  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n  return emailRegex.test(email);\n}\n```\n\nThis function:\n- Returns `true` for valid emails like `user@example.com`\n- Returns `false` for invalid formats like `user@`, `@domain`, or plain text\n- Uses a regex that checks for the required `@` and domain structure',
    },
  ],

  // ── Enterprise ──────────────────────────────────────────────────────────

  compliance_pre_assessment: [
    {
      user: 'assess this for OJK compliance: a mobile banking app that stores user biometric data on-device with no cloud backup',
      assistant:
        '## OJK Compliance Pre-Assessment\n\n**Scope**: Mobile banking app with on-device biometric storage\n\n**Risk Level**: Medium\n\n**Findings:**\n\n| Area | Status | Notes |\n|---|---|---|\n| Data Localization | ✅ Compliant | On-device storage meets OJK data residency requirements |\n| Encryption | ⚠️ Needs Review | Verify AES-256 for stored biometric templates |\n| User Consent | ✅ Compliant | Assumed consent obtained at enrollment |\n| Breach Notification | ✅ Compliant | On-device = reduced breach surface |\n\n**Recommendations:**\n1. Implement AES-256 encryption for biometric template storage\n2. Add remote wipe capability for lost devices\n3. Document the consent flow in the compliance register',
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
