Berikut adalah **Product Requirements Document (PRD) & Technical Design** untuk implementasi model baru (`anthropic.claude-sonnet-5`, `zai.glm-5`) beserta fitur **Model Access Control (Whitelist)**.

Dokumen ini dirancang agar terintegrasi mulus dengan arsitektur *Beexexity* yang sudah ada (Express, PostgreSQL, Routing Engine, Admin Dashboard).

---

# 📄 Requirements Document: New Models & Access Control

## 1. Ringkasan Fitur (Overview)
1. **Integrasi Model Baru**: Menambahkan `anthropic.claude-sonnet-5` dan `zai.glm-5` ke dalam registry model, pricing, dan routing policy.
2. **Model Visibility (Public/Private)**: Setiap model memiliki status visibilitas. Model `public` dapat diakses semua user. Model `private` hanya dapat diakses oleh user yang di-whitelist.
3. **Admin Access Management**: Admin dapat mengubah status model (Public ↔ Private) dan mengelola daftar user yang diizinkan mengakses model `private` melalui Admin Dashboard.
4. **Routing Engine Awareness**: *Auto-routing* dan *auto_v2* harus menghormati whitelist. Jika model terbaik untuk sebuah prompt adalah model `private` dan user tidak memiliki akses, router harus *fallback* ke model `public` terbaik berikutnya.

---

## 2. Database Schema Changes (PostgreSQL)

Kita perlu memindahkan konfigurasi model dari *hardcode* (`model-capabilities.ts` / `pricing-config.json`) ke database agar bisa diubah secara dinamis via Admin UI, atau setidaknya membuat tabel relasi untuk akses.

### Migration: `013_model_access_control.sql`

```sql
-- 1. Tabel untuk menyimpan metadata & visibilitas model (Menggeser dari static config)
CREATE TABLE models (
    model_id VARCHAR(128) PRIMARY KEY,
    display_name VARCHAR(128) NOT NULL,
    provider VARCHAR(64) NOT NULL,
    is_vision BOOLEAN DEFAULT FALSE,
    context_window INTEGER NOT NULL,
    is_public BOOLEAN DEFAULT TRUE, -- Kunci fitur whitelist
    pricing_input_per_1m NUMERIC(10,4) DEFAULT 0,
    pricing_output_per_1m NUMERIC(10,4) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabel mapping user ke model private (Whitelist)
CREATE TABLE user_model_access (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id VARCHAR(128) NOT NULL REFERENCES models(model_id) ON DELETE CASCADE,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, model_id)
);

-- Index untuk query cepat saat routing
CREATE INDEX idx_user_model_access_user ON user_model_access(user_id);
CREATE INDEX idx_models_visibility ON models(is_public, is_active);
```

---

## 3. Backend API & Service Updates

### 3.1. Model Registry & Config (`src/services/models.service.ts` - *New*)
Buat service baru untuk mengelola model dari DB, menggantikan/menimpa `model-capabilities.ts` untuk bagian yang dinamis.
* `getAvailableModels(userId: string)`: Mengembalikan daftar model yang bisa dilihat user (Public + Private yang di-whitelist).
* `getUserAllowedModelIds(userId: string)`: Mengembalikan array `model_id` yang diizinkan untuk user tersebut (digunakan oleh Routing Engine).

### 3.2. Inference Validation (`src/routes/inference.routes.ts`)
Update langkah **Validasi modelId**:
```typescript
// Pseudocode
if (modelId && modelId !== 'auto' && modelId !== 'auto_v2') {
    const model = await modelsService.getModel(modelId);
    if (!model || !model.is_active) throw 400("Model not found");
    
    if (!model.is_public) {
        const hasAccess = await modelsService.checkUserAccess(userId, modelId);
        if (!hasAccess) throw 403("Access denied: This model is private");
    }
}
```

### 3.3. Routing Engine Update (`src/services/routing-engine.service.ts`)
Ini adalah **perubahan paling kritis**. Fungsi `resolvePolicy(input)` harus menerima daftar model yang diizinkan oleh user.

```typescript
// Update signature
resolvePolicy(input: RoutingInput, allowedModelIds: string[]): string {
    // 1. Manual state -> honor user (sudah divalidasi di route)
    // 2. Filter candidate models berdasarkan allowedModelIds
    const candidates = ALL_MODELS.filter(m => allowedModelIds.includes(m.model_id));

    // 3. Apply existing logic (Long context -> Vision -> Text) 
    // TAPI hanya dari pool 'candidates'
    
    // Contoh: Jika user tidak punya akses claude-sonnet-5, 
    // maka untuk Vision High Complexity, router akan fallback ke qwen3-235b.
}
```
*Catatan*: `allowedModelIds` harus di-query di awal request lifecycle (langkah 13/14) dan di-pass ke `routeRequest()`.

### 3.4. Admin Routes (`src/routes/admin.routes.ts`)
Tambahkan endpoint baru:
* `GET /api/v1/admin/models` -> List semua model + jumlah user yang punya akses.
* `PUT /api/v1/admin/models/:modelId/visibility` -> Toggle `is_public` (Body: `{ is_public: boolean }`).
* `GET /api/v1/admin/models/:modelId/access` -> List user yang di-whitelist.
* `PUT /api/v1/admin/models/:modelId/access` -> Update whitelist (Body: `{ userIds: string[] }`).

---

## 4. Admin Dashboard UI (`public/admin.html`)

Tambahkan Tab baru atau Section baru di Admin Dashboard: **"Model Management"**.

### Fitur UI:
1. **Tabel Daftar Model**:
   * Kolom: Nama Model, Provider, Context, Visibilitas (Badge: 🟢 Public / 🔴 Private), Aksi.
2. **Toggle Visibilitas**:
   * Switch toggle untuk mengubah `is_public`.
   * *Warning Modal*: "Mengubah model menjadi Private akan memutus akses user yang tidak di-whitelist. Lanjutkan?"
3. **Manajemen Whitelist (Jika Private)**:
   * Tombol "Manage Access" pada model yang berstatus Private.
   * Membuka Modal/Drawer berisi daftar user (dengan search bar).
   * Checkbox untuk mencentang user mana saja yang boleh mengakses model tersebut.
   * Tombol "Save Access List".

---

## 5. Spesifikasi Model Baru

Tambahkan data ini ke dalam tabel `models` saat seeding/migrasi:

| Model ID | Display Name | Vision | Context | Default Visibility | Routing Role |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `anthropic.claude-sonnet-5` | Claude Sonnet 5 | Yes | 200K | **Private** | Text/Vision (High Quality Fallback) |
| `zai.glm-5` | GLM-5 | No | 128K | **Private** | Text (Alternative/Experimental) |

**Update Routing Policy (`resolvePolicy`)**:
* **Vision (High Complexity)**: `qwen3-235b` (Primary) $\rightarrow$ `anthropic.claude-sonnet-5` (Fallback jika user punya akses & Qwen throttle).
* **Text (Semua)**: `qwen3-235b` (Primary) $\rightarrow$ `anthropic.claude-sonnet-5` / `zai.glm-5` (Hanya jika di-invokasi manual atau Qwen down).
* *Catatan*: Karena Qwen3-235B sudah sangat kuat, model baru ini lebih baik diposisikan sebagai **Manual Override** atau **Fallback** agar tidak mengacaukan cost-routing yang sudah berjalan.

---

## 6. Edge Cases & Security Considerations

1. **Auto-Routing Fallback**: 
   * *Kasus*: User A (tidak punya akses Claude) mengirim prompt kompleks. Routing engine menilai Claude Sonnet 5 adalah model terbaik (skor 5).
   * *Solusi*: Routing engine **tidak boleh** memilih Claude. Ia harus memfilter Claude dari kandidat dan memilih Qwen3-235B.
2. **Model Di-toggle ke Private Saat User Sedang Chat**:
   * *Kasus*: Admin mengubah Claude dari Public ke Private, tapi User A (yang tidak di-whitelist) masih memiliki session aktif dan memilih Claude secara manual.
   * *Solusi*: Validasi akses dilakukan **per request** (di `inference.routes.ts`), bukan saat session dibuat. Jika User A mencoba generate lagi, mereka akan mendapat error 403 dan UI harus memberi tahu mereka untuk mengganti model.
3. **Frontend Model Dropdown**:
   * Dropdown model di `public/index.html` (termasuk mode Thinking) **hanya boleh menampilkan** model yang di-return oleh `GET /api/v1/models` (yang sudah difilter berdasarkan `userId` yang login).
4. **Audit Logging**:
   * Tambahkan kolom atau metadata di `audit_logs` jika terjadi `403 Forbidden` karena model access, agar admin bisa melacak siapa yang mencoba mengakses model private secara ilegal.

---

## 7. Rencana Implementasi (Step-by-Step)

1. **Phase 1: Database & Seeding**
   * Buat migration `013_model_access_control.sql`.
   * Buat script `scripts/seed-models.ts` untuk memindahkan data dari `pricing-config.json` ke tabel `models` dan memasukkan 2 model baru.
2. **Phase 2: Backend Core (Service & Routes)**
   * Implementasi `models.service.ts`.
   * Update `inference.routes.ts` untuk validasi akses.
   * Update `routing-engine.service.ts` untuk memfilter kandidat model berdasarkan `allowedModelIds`.
3. **Phase 3: Admin API**
   * Implementasi endpoint CRUD untuk visibilitas dan whitelist di `admin.routes.ts`.
4. **Phase 4: Frontend (User & Admin)**
   * Update `public/index.html` agar dropdown model memanggil API baru yang ter-filter.
   * Update `public/admin.html` untuk menambahkan tab "Model Management" beserta UI whitelist.
5. **Phase 5: Testing**
   * Unit test untuk `models.service.ts`.
   * Integration test untuk Routing Engine (memastikan auto-routing tidak memilih model private untuk user tanpa akses).

