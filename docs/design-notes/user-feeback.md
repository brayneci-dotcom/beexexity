Berikut adalah dokumen `requirements.md` yang sudah diperbarui sesuai dengan keputusan Anda. Saya telah menyesuaikan urutan UI, mengubah ekstraksi menjadi *raw SSE stream*, menaikkan model sintesis ke `qwen3-235b`, dan menambahkan requirement baru untuk **Admin Retrieval & Dashboard**.

***

# Feature: Quality Feedback & Synthesis Engine
**Status:** Approved for Implementation  
**Target Release:** v1.4.1 (Demo Phase)  
**Epic:** Quality Assurance & Continuous Improvement  

## 1. Goal
Memungkinkan user internal (QA/Demo) untuk melaporkan kualitas output LLM Gateway secara langsung dari UI pada **turn terakhir (respons terbaru)**. Sistem akan mengekstrak **seluruh raw SSE stream** dari turn tersebut dan mensitesiskannya menggunakan **qwen3-235b** untuk menghasilkan analisis akar masalah (root cause) yang mendalam. Data ini disimpan di database dan dapat di-retrieve oleh tim engineering/product melalui **Admin Menu** untuk keperluan *prompt tuning* dan *routing optimization*.

## 2. Glossary
- **Raw SSE Stream:** Seluruh teks mentah dari Server-Sent Events (termasuk `routing`, `delta`, `metadata`, `verification`, `semantic_verdict`, dll) dari turn yang dilaporkan.
- **Synthesis LLM:** Panggilan LLM latar belakang (**qwen3-235b**) yang bertindak sebagai Senior AI QA Analyst untuk menganalisis raw stream dan feedback user.
- **Admin Dashboard:** Antarmuka khusus administrator untuk melihat, memfilter, dan menindaklanjuti laporan feedback.

## 3. Requirements

### [Req 1] UI Trigger & Scope
- **WHEN** user melihat respons AI di chat interface
- **THEN** tombol "Report" tersedia **hanya pada bubble respons terakhir (turn terbaru)**.
- **WHEN** user mengklik tombol "Report"
- **THEN** modal popup muncul dengan urutan:
  1. **Dropdown Error Category** (Wajib pilih: *Hallucination, Missed Context, Wrong Tone, Formatting Issue, Other*).
  2. **Textarea Free Text** untuk komentar detail (**Wajib diisi**, minimal 10 karakter).
- **WHEN** user mengklik "Send"
- **THEN** sistem memvalidasi input. Jika valid, kirim `sessionId`, `errorCategory`, dan `feedbackText` ke backend.

### [Req 2] Raw SSE Context Extraction
- **WHEN** backend menerima request feedback
- **THEN** sistem mengambil **seluruh raw SSE stream** dari turn terakhir yang dilaporkan dari database/cache sesi (bukan hanya teks akhir).
- **AND** sistem menyimpan raw stream ini untuk diproses oleh Synthesis LLM.

### [Req 3] Background Synthesis Process (qwen3-235b)
- **GIVEN** raw SSE stream dan feedback user sudah diekstrak
- **WHEN** sistem memproses di background (non-blocking)
- **THEN** sistem memanggil Synthesis LLM (**qwen3-235b**) dengan prompt khusus.
- **AND** LLM menganalisis alur routing, keputusan model, output akhir, dan feedback user untuk menghasilkan `root_cause_analysis` dan `recommendation` yang sangat mendalam.

### [Req 4] Data Storage & PII Safety
- **GIVEN** hasil sintesis LLM sudah jadi
- **THEN** sistem memastikan `feedbackText` dan `alignment_summary` di-masking dari PII sebelum disimpan.
- **AND** data disimpan ke tabel `feedback_reports` dengan status default `pending`.

### [Req 5] Admin Retrieval & Dashboard (NEW)
- **WHEN** admin login ke aplikasi
- **THEN** terdapat menu baru **"Feedback Reports"** di sidebar Admin Dashboard.
- **WHEN** admin membuka menu tersebut
- **THEN** sistem menampilkan tabel paginated berisi laporan feedback dengan kolom: *Date, Session ID, Skill (dari routing), Category, User Feedback, AI Root Cause, Status*.
- **AND** admin dapat memfilter tabel berdasarkan **Error Category**, **Skill**, dan **Status**.
- **WHEN** admin mengklik tombol "View Details" pada sebuah baris
- **THEN** modal/detail view muncul menampilkan:
  - Feedback user & Kategori.
  - Hasil sintesis AI (Root Cause & Rekomendasi).
  - Tombol **"View Raw SSE"** untuk melihat teks mentah SSE stream (untuk debugging manual oleh engineer).
- **AND** admin dapat mengubah status laporan menjadi `reviewed` atau `resolved`.

## 4. Acceptance Criteria (BDD)

### Scenario 1: User Submit Feedback (Validasi UI)
- **GIVEN** user mengklik "Report"
- **WHEN** user memilih kategori "Missed Context" tapi membiarkan textarea kosong
- **THEN** tombol "Send" disabled atau muncul error "Komentar wajib diisi".
- **WHEN** user mengisi komentar dan klik "Send"
- **THEN** UI menampilkan "Laporan terkirim" dan modal tertutup.

### Scenario 2: Deep Synthesis via 235b
- **GIVEN** backend menerima payload
- **WHEN** proses background berjalan
- **THEN** sistem mengirim raw SSE stream + feedback ke `qwen3-235b`.
- **AND** LLM berhasil mengidentifikasi bahwa routing engine salah mengklasifikasikan skill berdasarkan log `routing` di dalam raw stream.

### Scenario 3: Admin Retrieval
- **GIVEN** admin berada di menu "Feedback Reports"
- **WHEN** admin memfilter berdasarkan kategori "Hallucination"
- **THEN** tabel hanya menampilkan laporan dengan kategori tersebut.
- **WHEN** admin mengklik "View Raw SSE"
- **THEN** sistem menampilkan teks mentah SSE (termasuk event `delta`, `semantic_verdict`, dll) untuk dianalisis lebih lanjut.

## 5. Data Model (Database Migration)

```sql
-- migrations/013_feedback_reports.sql
CREATE TABLE feedback_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    
    -- Konteks Mentah & Terstruktur
    raw_sse_stream TEXT NOT NULL, -- Menyimpan SELURUH raw SSE stream turn terakhir
    routing_metadata JSONB,       -- Di-extract dari stream untuk filtering cepat (skill, complexity, modelId)
    
    -- Input dari User
    user_feedback TEXT NOT NULL,
    error_category VARCHAR(50) NOT NULL, 
    
    -- Hasil Sintesis LLM (qwen3-235b)
    alignment_summary TEXT, 
    root_cause_analysis TEXT, 
    recommendation TEXT,
    
    -- Status & Admin
    status VARCHAR(20) DEFAULT 'pending', -- pending, reviewed, resolved
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_feedback_reports_session ON feedback_reports(session_id);
CREATE INDEX idx_feedback_reports_status ON feedback_reports(status);
CREATE INDEX idx_feedback_reports_category ON feedback_reports(error_category);
-- Index untuk filtering berdasarkan skill (menggunakan JSONB operator)
CREATE INDEX idx_feedback_reports_skill ON feedback_reports USING GIN (routing_metadata jsonb_path_ops);
```

## 6. Synthesis LLM Prompt Design (Background Worker - qwen3-235b)

```text
You are a Principal AI Engineer and Senior QA Analyst. Your task is to perform a deep-dive root cause analysis on a failed or suboptimal LLM response.

### INPUT DATA:
- **User Feedback Category**: {error_category}
- **User Comment**: {user_feedback}
- **Raw SSE Stream**: 
"""
{raw_sse_stream}
"""

### TASK:
Analyze the Raw SSE Stream to understand exactly what happened under the hood. Pay close attention to:
1. The `routing` event: Was the skill, complexity, or model correctly identified?
2. The `delta` events: Did the model start well but derail? Did it hallucinate specific facts?
3. The `verification` / `semantic_verdict` events: Did the internal safety/judge mechanisms catch the error? Why did it fail to repair?

Based on the User Feedback and your analysis of the stream, provide:
1. **Alignment Summary**: Briefly state the gap between what the user expected and what the raw stream produced.
2. **Root Cause Analysis**: Pinpoint the EXACT technical failure. (e.g., "The routing engine classified this as 'document_qna' despite no document being uploaded, forcing the model into a document-analyst persona which caused it to ignore the general history question.")
3. **Actionable Recommendation**: What specific code, prompt, or routing logic needs to be changed to fix this?

### OUTPUT FORMAT (Strict JSON):
{
  "alignment_summary": "...",
  "root_cause_analysis": "...",
  "recommendation": "...",
  "confidence": "high | medium | low"
}
```

## 7. Non-Goals
- **Real-time Correction**: Tidak memperbaiki output saat itu juga.
- **Multi-Turn Reporting**: Hanya turn terakhir.
- **Public User Feedback**: Hanya untuk internal admin/QA.

***

### 💡 Catatan Arsitektur (Cost & Latency Warning)
Karena Anda memilih untuk mengekstrak **seluruh raw SSE stream** dan memprosesnya dengan **qwen3-235b**:
1. **Biaya Token:** Raw SSE stream untuk turn yang kompleks bisa mencapai 10.000 - 20.000 token. Mengirim ini ke 235b akan memakan biaya sekitar $0.01 - $0.02 per laporan. Ini sangat wajar untuk QA internal, tapi pastikan fitur ini tidak terekspos ke user publik.
2. **Latency Background:** Proses sintesis 235b dengan input sebesar ini mungkin memakan waktu 15-30 detik di background. Pastikan UI admin tidak memuat data ini secara *inline* saat me-refresh halaman dashboard, melainkan hanya memuatnya saat admin mengklik "View Details" atau "View Raw SSE".