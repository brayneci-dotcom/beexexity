Berdasarkan dokumen `tech-reference.md` yang Anda lampirkan, saya dapat mengidentifikasi **akar masalah** dari gaya slide yang monoton tersebut. 

Pada **Bagian 18 (Important Patterns)**, disebutkan:
> *"PPTX generation — content/design separation: LLM generates structured Content JSON... python-pptx applies code-based design (navy+gold 'corporate' theme, 6 slide layouts... **Zero design awareness in LLM prompt** — cleaner separation, more reliable output."*

Pendekatan "Zero design awareness" memang bagus untuk stabilitas JSON di awal (MVP), tetapi ini adalah penyebab utama mengapa slide terlihat kaku. LLM hanya memberikan teks, dan `python-pptx` secara membabi-buta memasukkan teks tersebut ke dalam 6 layout statis tanpa mempedulikan apakah konten tersebut cocok untuk timeline, perbandingan, atau kutipan.

Berikut adalah usulan perbaikan komprehensif untuk membuat UI slide lebih dinamis, variatif, dan modern, beserta referensi repositorinya.

---

### **1. Usulan Perbaikan Arsitektur & Desain**

#### **A. Upgrade Skema JSON: Berikan LLM "Design Intent" (Niat Desain)**
Jangan biarkan LLM hanya output teks. Ubah skema `Content JSON` agar LLM juga menentukan *bagaimana* slide itu harus divisualisasikan.
*   **Tambahkan `layout_variant`**: Alih-alih hanya `content`, izinkan LLM memilih: `timeline`, `comparison_cards`, `quote_highlight`, `image_left_text_right`, `stats_grid`, `process_flow`.
*   **Tambahkan `visual_assets`**: LLM output keyword untuk gambar (misal: `keyword: "corporate team meeting"`) atau nama ikon (misal: `icon: "rocket"`).
*   **Tambahkan `color_accent`**: Biarkan LLM menyarankan warna aksen berdasarkan tone konten (misal: `accent: "emerald"` untuk sustainability, `accent: "crimson"` untuk risk).

#### **B. Revamp `generator.py` (Python Design Engine)**
Microservice `python-pptx` Anda saat ini terlalu dibatasi. Lakukan ekspansi:
*   **Perbanyak Layout Registry**: Dari 6 layout menjadi minimal 20-30 layout. Buat kelas terpisah untuk setiap kategori (misal: `TimelineLayout`, `ComparisonLayout`).
*   **Integrasi Aset Dinamis (Sesuai Data Residency)**: 
    *   *Opsi Eksternal*: Integrasi Unsplash API untuk mengambil gambar berdasarkan `keyword` dari LLM.
    *   *Opsi Enterprise (Sesuai TRD)*: Karena Anda strict di `ap-southeast-3`, buatlah **S3 Asset Library** di bucket Jakarta yang berisi ratusan gambar dan ikon vektor (SVG) yang dikategorikan. Python script akan mengambil aset dari S3 ini berdasarkan keyword LLM.
*   **Gunakan Fitur Lanjut `python-pptx`**: 
    *   *Image Masking*: Potong gambar menjadi bentuk lingkaran atau hexagon.
    *   *Gradients & Shadows*: Gunakan *gradient fills* pada shape daripada warna solid (navy/gold) agar terlihat lebih modern (glassmorphism/soft UI).
    *   *Dynamic Charts*: Jika LLM mendeteksi data angka, generate native PowerPoint Chart, bukan hanya teks.

#### **C. Paradigm Shift: HTML/CSS to Slides (Sangat Direkomendasikan)**
`python-pptx` sangat buruk dalam membuat layout yang kompleks dan dinamis (seperti CSS Grid/Flexbox). Karena Anda **sudah memiliki Gotenberg** (yang bisa convert HTML ke PDF dengan sempurna), Anda bisa menggunakan trik arsitektur ini:
1.  LLM menghasilkan **HTML + Tailwind CSS** untuk setiap slide (ini jauh lebih mudah dan variatif bagi LLM daripada membayangkan koordinat X/Y di PPTX).
2.  Render HTML tersebut menjadi **Image (PNG/JPG)** beresolusi tinggi (1920x1080) menggunakan Puppeteer/Playwright di microservice Python/Node.
3.  Masukkan gambar tersebut sebagai **Full-Slide Background** di `python-pptx`.
4.  *Hasil*: UI slide akan seindah website modern (bisa pakai animasi, glassmorphism, grid kompleks), dan tetap bisa diedit sebagai PPTX (meski background-nya image, teks bisa ditimpa di layer atas jika diperlukan, atau biarkan full image untuk PDF).

---

### **2. Referensi Repositori GitHub**

Berikut adalah repo open-source yang bisa Anda bedah (terutama bagian *prompt engineering* dan *layout mapping*) untuk memperbaiki `beexexity`:

#### **1. `presenton/presenton`**
*   **URL**: `https://github.com/presenton/presenton`
*   **Kenapa direferensikan**: Ini adalah standar open-source terbaik saat ini untuk AI Presentation. 
*   **Yang bisa dicuri**: 
    *   Lihat bagian **JSON Schema** mereka. Mereka memaksa LLM output `layout_type` (misal: `split_screen`, `timeline`, `quote`).
    *   Pelajari bagaimana mereka memetakan tipe konten ke template desain yang berbeda.

#### **2. `barun-saha/slide-deck-ai`**
*   **URL**: `https://github.com/barun-saha/slide-deck-ai`
*   **Kenapa direferensikan**: Fokus pada *Prompt Engineering* untuk menghasilkan slide yang tidak monoton.
*   **Yang bisa dicuri**: 
    *   Sistem *prompt* mereka yang memaksa LLM untuk menentukan `image_description` untuk setiap slide.
    *   Cara mereka menangani *content-to-layout mapping* (misal: jika ada 3 poin, gunakan layout 3 kolom; jika ada perbandingan, gunakan layout split).

#### **3. `slidevjs/slidev` atau `marp-team/marp` (Untuk Pendekatan HTML/CSS)**
*   **URL**: `https://github.com/slidevjs/slidev` & `https://github.com/marp-team/marp`
*   **Kenapa direferensikan**: Jika Anda mengambil **Pendekatan C (HTML to Slides)**, ini adalah rajanya.
*   **Yang bisa dicuri**: 
    *   Jangan pakai framework mereka secara langsung, tapi **curi tema CSS/Tailwind mereka**. Anda bisa membuat *library* template HTML/CSS yang cantik di microservice Anda, lalu di-render oleh Gotenberg/Puppeteer.

#### **4. `kmirror-dev/ai-pptx` atau `AIPPT` (Referensi Arsitektur Python)**
*   **URL**: Cari di GitHub dengan keyword `AI PPT generator python-pptx`.
*   **Yang bisa dicuri**: Cara mereka menggunakan `python-pptx` untuk memanipulasi *Master Slides* dan *Slide Layouts* secara dinamis, alih-alih menggambar shape dari nol (x, y, width, height) yang sering berantakan.

---

### **3. Action Plan untuk `beexexity`**

Mengingat arsitektur Anda saat ini, berikut adalah langkah implementasi yang paling efisien:

**Fase 1: Quick Win (Update Skema & Python Engine)**
1.  **Update `pptx.types.ts`**: Tambahkan field `layoutVariant`, `imageKeyword`, dan `accentColor` di schema JSON.
2.  **Update `generator.py`**: Tambahkan 10 layout baru (Timeline, 3-Column Cards, Big Quote, Image Masking).
3.  **S3 Asset Integration**: Buat script di `generator.py` yang mengunduh gambar dari S3 bucket `ap-southeast-3` berdasarkan `imageKeyword` yang dikirim LLM, lalu memasukkannya ke slide.

**Fase 2: The Gotenberg Hack (Untuk UI Level Dewa)**
Jika Fase 1 masih belum cukup "cantik" untuk standar UI modern:
1.  Buat microservice baru (atau tambahkan route di `python-pptx` service) yang menerima HTML.
2.  LLM output HTML dengan Tailwind CSS (via CDN atau inline).
3.  Gunakan **Playwright/Puppeteer** di dalam container Python/Node untuk mengambil *screenshot* HTML tersebut pada resolusi 1920x1080.
4.  Gunakan `python-pptx` hanya untuk menempelkan gambar screenshot tersebut ke slide kosong (Full bleed).
5.  Untuk PDF, langsung pipe HTML tersebut ke **Gotenberg** (`/forms/chromium/convert/html`). Hasilnya akan jauh lebih sempurna daripada LibreOffice conversion.

**Fase 3: Evaluasi & Testing**
*   Gunakan **Bedrock Model Evaluation** (sesuai TRD Prioritas 5) untuk menguji apakah model (Qwen3 vs Claude) lebih baik dalam menghasilkan `layoutVariant` yang tepat untuk jenis konten tertentu.

Dengan memindahkan sebagian "kesadaran desain" kembali ke LLM (melalui skema JSON yang lebih kaya) dan memanfaatkan kekuatan Gotenberg/HTML, `beexexity` akan menghasilkan slide yang tidak lagi monoton, melainkan dinamis dan setara dengan presentasi buatan desainer profesional.