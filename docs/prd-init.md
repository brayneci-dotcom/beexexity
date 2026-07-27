PRODUCT REQUIREMENTS DOCUMENT (PRD)
Nama Produk: Unified Inference Gateway (Built-in) berbasis AWS Bedrock
Versi Dokumen: 1.0 (MVP)
Tanggal: 23 Juni 2026
Status: Draft untuk Persetujuan
1. Ringkasan Eksekutif
Proyek ini bertujuan untuk membangun modul Unified Inference Gateway yang terintegrasi langsung (built-in) ke dalam aplikasi internal perbankan. Gateway ini akan menggantikan Google Gemini Enterprise dengan memanfaatkan AWS Bedrock di region Jakarta (ap-southeast-3) untuk menjamin kedaulatan data (data residency) sesuai regulasi OJK dan Bank Indonesia.
Fokus utama MVP adalah menyediakan akses ke 5 model LLM besar, mekanisme PII Masking otomatis untuk melindungi data nasabah, serta fitur rekomendasi model dengan pemilihan manual oleh pengguna.
2. Ruang Lingkup (Scope)
2.1. In-Scope (MVP)
Integrasi native dengan 5 Model di AWS Bedrock (ap-southeast-3): NVIDIA Nemotron 3 Super 120B A12B, Open AI gpt-oss-120b, Qwen3 235B A22B 2507, Qwen3 32B, DeepSeek-V3.1.
Mesin Inferensi dengan skema On-Demand (per token).
PII Masking/Redaction Engine (Pre-processing & Post-processing).
Smart Model Recommender (Sistem memberikan rekomendasi, user memilih secara manual).
Autentikasi lokal (Username/Password + JWT) dengan whitelist database.
Manajemen User via API (Registrasi & Update Profil/Role).
Audit log dasar (Metadata interaksi, tanpa menyimpan full prompt/response).
2.2. Out-of-Scope (Next Milestone)
Fitur Generate PDF/Slide (Agentic Workflow).
Integrasi dengan Corporate IDP (LDAP/AD/Okta).
Role-Based Access Control (Pembatasan model berdasarkan role).
Penyimpanan full prompt & response untuk audit forensik.
3. Kebutuhan Fungsional (Functional Requirements)
3.1. Autentikasi & Manajemen Pengguna
FR-1.1 Login: Pengguna harus dapat login menggunakan Username & Password. Sistem akan memvalidasi terhadap whitelist database lokal dan menerbitkan token JWT untuk sesi berikutnya.
FR-1.2 User Management API: Penyediaan endpoint API khusus (untuk admin) untuk:
Mendaftarkan akun baru (memasukkan user ke dalam whitelist DB).
Mengupdate data profil dan role pengguna.
FR-1.3 Session Management: Validasi JWT pada setiap request inferensi. Token harus memiliki masa kedaluwarsa (expiry) yang aman.
3.2. PII Masking/Redaction Engine (Wajib OJK/BI)
FR-2.1 Deteksi PII: Sebelum prompt dikirim ke AWS Bedrock, sistem wajib memindai dan mendeteksi entitas sensitif: NIK, Nomor Rekening, Nomor HP, Nama Orang, dan Nama Bank.
FR-2.2 Masking (Pre-processing): Mengganti data sensitif yang terdeteksi dengan placeholder anonim (contoh: [NIK], [NO_REKENING], [NAMA]) menggunakan teknik Named Entity Recognition (NER) atau Regex yang terkalibrasi.
FR-2.3 Unmasking (Post-processing): Setelah model mengembalikan respons, sistem wajib melakukan unmasking (mengembalikan placeholder ke data asli) agar konteks jawaban yang diterima pengguna tetap utuh dan dapat dibaca, tanpa mengekspos data ke pihak ketiga (Model).
3.3. Smart Model Recommender & Manual Selection
FR-3.1 Analisis Prompt: Saat pengguna memasukkan prompt, sistem (menggunakan rule-based engine, keyword heuristic, atau model classifier kecil/cepat) akan menganalisis natur tugas (misal: coding, reasoning, summarization, multilingual).
FR-3.2 Rekomendasi Otomatis: Sistem menampilkan rekomendasi model terbaik di UI beserta alasannya (misal: "Direkomendasikan: Qwen3 235B - Kompleksitas Penalaran Tinggi").
FR-3.3 Pemilihan Manual: Pengguna memiliki kendali penuh untuk mengonfirmasi rekomendasi atau memilih model lain secara manual dari daftar 5 model yang tersedia melalui dropdown di UI sebelum menekan tombol "Generate/Submit".
3.4. Inference Engine
FR-4.1 Routing ke Bedrock: Meneruskan prompt yang sudah di-masking ke AWS Bedrock menggunakan Converse API di region ap-southeast-3.
FR-4.2 Model Selection: Mengirim request ke Model ID spesifik sesuai dengan pilihan manual pengguna.
FR-4.3 Streaming Response: Mendukung mode streaming (Server-Sent Events) agar pengguna dapat melihat respons model secara real-time (token demi token) untuk mengurangi persepsi latency.
4. Kebutuhan Non-Fungsional (Non-Functional Requirements)
4.1. Keamanan & Kepatuhan (OJK/BI)
NFR-1.1 Data Residency: Seluruh pemrosesan data (prompt, masking, inferensi, log) wajib terjadi di dalam region AWS ap-southeast-3 (Jakarta). Tidak ada data yang ditransmisikan ke region luar Indonesia.
NFR-1.2 Zero Data Retention oleh Model: Memastikan konfigurasi AWS Bedrock tidak menggunakan data input untuk melatih model dasar (zero data retention).
NFR-1.3 Enkripsi: Data at-rest (database whitelist, log) dienkripsi menggunakan AWS KMS. Data in-transit dienkripsi menggunakan TLS 1.2+.
4.2. Logging & Audit Trail (MVP)
NFR-2.1 Basic Audit Log: Sistem wajib mencatat metadata interaksi untuk keperluan audit dasar. Log mencakup:
Timestamp
User ID / Username
Model yang dipilih
Jumlah token yang digunakan (Input/Output)
Status request (Success/Failed)
NFR-2.2 No Full Content Logging: Sesuai kesepakatan MVP, DILARANG menyimpan isi full prompt dan full response di database log untuk meminimalkan risiko kebocoran data.
4.3. Performa & Skalabilitas
NFR-3.1 Throughput: Menggunakan skema On-Demand dari AWS Bedrock. Sistem harus mampu menangani retry mechanism (exponential backoff) jika terjadi throttling atau rate limit sementara dari sisi AWS.
NFR-3.2 Fallback: Jika satu model mengalami error atau timeout dari sisi AWS, sistem akan mengembalikan pesan error yang jelas kepada pengguna (tidak ada auto-fallback ke model lain di MVP).
5. Arsitektur & Alur Sistem (System Flow)
Karena Gateway ini built-in di aplikasi, alur kerjanya adalah sebagai berikut:
User Input: Pengguna mengetik prompt di UI aplikasi.
Rekomendasi: Modul Recommender menganalisis prompt dan menampilkan saran model di UI.
Manual Selection: Pengguna memilih model (mengonfirmasi saran atau memilih manual).
PII Masking: Modul PII Masker memindai prompt, menyimpan data asli di memori sementara (in-memory mapping), dan mengganti PII dengan placeholder.
Inference: Prompt yang sudah di-masking dikirim ke AWS Bedrock (ap-southeast-3) via built-in Gateway module.
Response & Unmasking: Respons dari Bedrock diterima. Modul PII Masker melakukan unmasking menggunakan in-memory mapping sebelumnya.
Display & Logging: Respons final ditampilkan ke user (streaming). Metadata transaksi dicatat ke database audit lokal.
6. Spesifikasi API (High-Level)
Berikut adalah endpoint API yang diperlukan untuk manajemen dan inferensi:
A. Authentication & User Management
POST /api/v1/auth/login - Login (mengembalikan JWT).
POST /api/v1/admin/users - Registrasi user baru (Whitelist).
PUT /api/v1/admin/users/{id} - Update profil/role user.
B. Inference Gateway
POST /api/v1/inference/recommend - Menganalisis prompt dan mengembalikan rekomendasi model.
POST /api/v1/inference/generate - Menerima prompt + pilihan model, melakukan masking, memanggil Bedrock, unmasking, dan mengembalikan respons (mendukung streaming).