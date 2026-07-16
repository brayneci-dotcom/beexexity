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

  requirement_generation: [
    {
      user: 'buat dokumen requirement untuk sistem helpdesk IT internal. Sistem harus bisa menerima tiket dari email dan web, assign otomatis ke agent berdasarkan kategori, dan punya SLA escalation. Target: 500 tiket/hari, 50 agent.',
      assistant:
        '# 📘 Sistem Helpdesk IT – Dokumen Master Requirement\n**Versi:** 1.0\n**Status:** DRAFT\n\n---\n\n## BAGIAN 1: Ringkasan Eksekutif & Strategi Implementasi\n\n### 1.1 Konteks Bisnis & Target KPI\n- **Baseline:** Tiket masuk via email manual, assignment manual oleh supervisor, rata-rata waktu respons 4 jam, tidak ada SLA tracking.\n- **Target KPI:** Waktu respons first-reply < 15 menit, SLA compliance > 95%, auto-assignment accuracy > 80%.\n\n### 1.2 Strategi Pembagian Fase\n- **FASE 1: MVP** — Ticket ingestion (email + web portal), manual assignment, SLA timer & escalation dasar.\n- **FASE 2: Advanced** — Auto-assignment berbasis kategori & beban kerja, knowledge base integration, dashboard reporting.\n\n---\n\n## BAGIAN 2: Non-Functional Requirements (NFR) Global\n- **Throughput:** Mampu menangani puncak 500 tiket/hari, 50 agent concurrent.\n- **Availability:** Uptime 99,5%.\n- **Latency:** Pembuatan tiket < 2 detik, pencarian tiket < 1 detik.\n- **Resiliency:** Jika email gateway down, web portal tetap berfungsi.\n\n---\n\n## BAGIAN 3: Prinsip Desain & Arsitektur\n1. **Multi-Channel Ingestion:** Email dan web portal sebagai channel terpisah dengan normalizer.\n2. **Agent Assignment Engine:** Rule-based + round-robin dengan weight beban kerja.\n3. **SLA Engine:** Timer per tiket, eskalasi otomatis jika SLA breach.\n\n---\n\n## BAGIAN 4: User Story & Acceptance Criteria\n\n### FASE 1: MVP\n\n#### Domain: Ticket Ingestion\n**US 1.1: Email Ticket Ingestion**\n- **Actor:** Email Gateway (System)\n- **Story:** Sebagai Email Gateway, saya ingin memproses email masuk menjadi tiket helpdesk agar pengguna dapat membuat tiket tanpa meninggalkan email client mereka.\n- **UAC:**\n  1. **Given** email masuk ke helpdesk@company.com, **When** system memproses, **Then** tiket terbuat dengan status `OPEN` dalam **< 30 detik**.\n  2. **Given** email memiliki attachment, **When** diproses, **Then** lampiran tersimpan dan terhubung ke tiket (max 10MB/file).\n  3. **Given** email dari pengirim tidak dikenal, **When** system memproses, **Then** tiket tetap terbuat dengan flag `UNVERIFIED`.\n\n**US 1.2: Web Portal Ticket Creation**\n- **Actor:** End User (Human)\n- **Story:** Sebagai pengguna, saya ingin membuat tiket melalui web portal dengan mengisi form kategori, prioritas, dan deskripsi agar permintaan saya tercatat secara terstruktur.\n- **UAC:**\n  1. **Given** user mengakses portal, **When** mengisi form dan submit, **Then** tiket terbuat dengan nomor tiket unik dalam **< 2 detik**.\n  2. **Given** user memilih kategori "Jaringan", **When** tiket terbuat, **Then** sistem otomatis mengkategorikan sebagai `NETWORK`.\n\n---\n\n## BAGIAN 5: Strategi Data & Governance\n1. **Audit Trail:** Setiap perubahan status tiket dicatat immutable (Timestamp, Actor, Action, Old Status, New Status).\n2. **Data Retention:** Tiket closed diarsipkan ke cold storage setelah 90 hari.\n\n---\n\n## BAGIAN 6: Instruksi Handover untuk Tim System Design\n1. **Email Gateway:** Rancang IMAP/POP3 listener dengan retry logic.\n2. **SLA Engine:** Rancang timer service dengan Redis pub/sub untuk escalation trigger.\n3. **Auto-Assignment (Fase 2):** Rancang rule engine dengan bobot agent dan kategori.',
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

  cloud_security: [
    {
      user: 'evaluasi keamanan cloud GCP',
      assistant:
        '## Cloud Security Assessment\n\n**Scope**: GCP WAF & Apigee\n\n**Findings**:\n- WAF ruleset belum mencakup OWASP CRS\n- Logging belum terintegrasi dengan Cloud SCC\n\n**Recommendations**:\n1. Aktifkan managed WAF ruleset\n2. Integrasikan dengan Cloud Logging\n3. Konfigurasi alerting untuk anomali traffic',
    },
  ],

  credit_analyst: [
    {
      user: 'review dokumen SLIK atas nama nasabah',
      assistant:
        '## Analisis Kredit\n\n**Ringkasan SLIK**: {ringkasan}\n\n**Temuan Utama**:\n- {temuan_1}\n- {temuan_2}\n\n**Rekomendasi**: {rekomendasi}',
    },
  ],

  it_specialist: [
    {
      user: 'analisis sistem pembayaran BI-FAST',
      assistant:
        '## IT System Analysis\n\n**System**: BI-FAST Payment\n\n**Architecture**:\n- Integration points: core banking, BI-RTGS, EASY\n- Security: Real Time Anomaly Alert, Auto Stop Button\n\n**Key Components**:\n1. Fraud Detection Rule\n2. Alert Monitoring Saldo GWM\n3. Rekonsiliasi Saldo Otomatis',
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
