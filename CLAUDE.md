@AGENTS.md

# Keychain Generator v2 — ringkasan untuk setiap sesi

Aplikasi internal Next.js milik Rofiq (Kedai Creative) untuk memproses pesanan gantungan kunci akrilik: input resi, antrean, nesting ke lembar 310×470 mm, lalu ekspor DXF (potong) dan JPG (cetak). Ada modul terpisah untuk plakat Bahan Mahar. Detail produk ada di `docs/PRD.md`. Detail teknis ada di `docs/ARCHITECTURE.md`.

Konteks bisnis (Shopee, TikTok Shop, BigSeller, Accurate, dan merek lain) dijelaskan di PRD. Kode saat ini belum terhubung ke sistem itu. Pesanan diketik manual.

## Cabang

- `main` adalah dasar yang sudah rilis sebagai nesting lama (tag `nesting-v1-stable`). Tidak punya tes.
- `feature/nesting-v2` menambah nesting per resi, baru pratinjau, belum dipakai produksi. Ada di atas `main`.
- `feature/nesting-v3-compact` memuat semua commit `main` dan `nesting-v2`, plus mesin produksi, perbaikan resi PAT, dan 341 tes. Tag `production-nesting-v1-stable` ada di sini, belum di `main`.
- `versi-lengkap` untuk ditinjau Rofiq. Dasarnya v3-compact pada `024e942`, ditambah kontur PR #2 dan nesting siap produksi (satu resi satu blok, kolom `rotation_deg`). Belum di `main`.

Fitur yang belum masuk `main` harus ditulis jelas sebagai **ada di branch, belum di main**. Jangan dianggap sudah dipakai di `main`.

## Aturan kerja

1. Setiap sesi fitur wajib membaca `docs/PRD.md` dan `docs/ARCHITECTURE.md` sebelum mengubah kode, lalu memperbarui kedua dokumen itu setelah selesai. Jika temuan audit atau urutan kerja berubah, perbarui juga `docs/AUDIT.md` dan `docs/ROADMAP.md`.
2. Satu fitur per sesi, satu branch, satu pull request. Jangan mencampur perbaikan yang tidak berhubungan.
3. Jangan pernah commit `.env`, API key, token, file kredensial, atau database `sqlite.db`. `.gitignore` di `main` sudah mengabaikan `.env*`. Aturan tambahan untuk `*.key` dan file kredensial baru ada di branch `feature/nesting-v3-compact`, belum di `main`.
4. Jangan mengubah kode aplikasi hanya untuk “merapikan”. Perbaikan produksi yang sudah ada di `feature/nesting-v3-compact` jangan ditulis ulang di `main`. Bawa branch itu lewat PR terpisah.
5. Sebelum mengubah API Next.js, baca panduan di `node_modules/next/dist/docs/` (lihat `AGENTS.md`). Versi Next di repo ini punya perbedaan dari versi lama.
6. `README.md` masih teks bawaan Create Next App. Jangan dihapus diam-diam. Jika diganti, pindahkan informasi yang masih benar ke `docs/`.

## Cabang ulasan `versi-lengkap`

Branch ini untuk ditinjau Rofiq. Dasarnya `feature/nesting-v3-compact` pada commit `024e942`, ditambah dua pekerjaan yang belum ada di `main`:

- PR #2 (`cursor/kontur-halus-0ae8`): garis potong 2,5 mm (`OUTLINE_OFFSET_MM`), sambungan bulat, `GAP_CLOSE_MM` = 2. Angka ini tetap, tidak diubah sesi nesting.
- Nesting siap produksi, dibawa dari PR #3 (`cursor/nesting-blok-bentuk-8dbc`): satu resi = satu blok berbingkai, rotasi 0/90/180/270, jarak 1 mm diukur pada garis potong, tinggi luar keping sebagai setelan (bawaan 26 mm nama, 29 mm tokoh). Sudut disimpan di kolom `staging_items.rotation_deg`.

Dokumen induk di `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/AUDIT.md`, dan `docs/ROADMAP.md` tetap dipakai. Angka benchmark 37 lembar ada di `docs/nesting/PENGUKURAN.md`.

## Menyalakan aplikasi

Database dan unggahan tidak ada di GitHub. `.gitignore` mengabaikan `.env`, `sqlite.db`, `sqlite.db-wal`, `sqlite.db-shm`, dan `public/uploads`. Salin dari Google Drive Rofiq, folder **Mastre Bot Ganci Sebelum Grox / keychain-generator-v2**. Pakai ketiga berkas database yang ada di root folder itu (salinan Oktober). Jangan dicampur dengan salinan September yang terpisah. Salin ketiganya bersama-sama: berkas WAL lebih baru daripada `sqlite.db`, dan SQLite butuh keduanya.

1. `git checkout versi-lengkap`
2. `npm ci`
3. Salin `sqlite.db`, `sqlite.db-wal`, dan `sqlite.db-shm` ke root repo.
4. Salin folder `public/uploads` dari Drive ke `public/uploads`.
5. `cp .env.example .env` (isinya `DATABASE_URL=sqlite.db`). Jangan commit `.env`.
6. `npm run db:migrate` jika database yang disalin belum memakai migrasi di repo. `main` berhenti di `0016_icy_misty_knight`. Branch ini menambah `0017_shape_block_rotation` (kolom `rotation_deg`). Database yang sudah di 0016 cukup di-migrate sekali lagi. Baris lama yang kolomnya kosong tetap dibaca seperti dulu.
7. `npm run dev`

`npm run build` membaca database saat membuat halaman depan. Salin database, atau jalankan migrasi pada database kosong, sebelum build. Build tanpa tabel membuat `sqlite.db` kosong dan gagal dengan `no such table: order_items`.

Jangan pernah commit `.env`, berkas database, `public/uploads`, folder `local-fonts` (font Coffee Soda), API key, atau kredensial. Satu-satunya berkas env yang boleh masuk Git adalah `.env.example`.

## Keputusan Rofiq — susunan lembar (10 November 2026)

1. Jarak antar potongan tetap 1 mm dulu (`CUT_CLEARANCE_MM` di `lib/nesting/shape-block-config.ts`).
2. Nama panjang tidak wajib tegak. Arah 0/90/180/270 dipilih hanya untuk menghemat bahan.
3. Luas cetak 31 × 47 cm (310 × 470 mm).

Angka pembanding dengan foto manual ada di `docs/nesting/PENGUKURAN.md`.

Lembar yang sudah tersimpan sebelum kontur 2,5 mm tidak boleh dikunci begitu saja. Garis potong dihitung ulang saat lembar dibuka. Kalau ukurannya berubah, atau satu resi ada di dua lembar, Staging menandai INVALID dan menyuruh bongkar lalu kirim ulang dari Antrean. Jangan commit snapshot database pelanggan.

## Sesi: tombol Staging “Mulai Susun Lembar Kerja”

**Keputusan.** Tombol di halaman Staging menyusun semua resi yang masih pending dengan Production Nesting. Di branch ini Production Nesting adalah susunan per resi (blok berbingkai, jarak 1 mm pada garis potong). Server yang mengisi daftar nama. Permintaan kosong tanpa tanda `allPending` tetap ditolak, supaya pemanggil lain tidak diam-diam menyusun seluruh antrean. Memilih sebagian nama tetap dari Antrean Pesanan.

**Akar masalah.** Tombol lama memanggil `POST /api/staging/nest` tanpa body. Route butuh `selections` (`itemId:indeksNama`). Tanpa daftar itu jawabannya selalu 400 “Pilih minimal satu pesanan untuk disusun”, meskipun resi pending sudah ada di database, dan tidak ada baris `staging_items` yang ditulis. Mengganti tombol dengan tautan ke Antrean hanya menyembunyikan error.

**Yang diubah.** `lib/staging-start.ts`, `POST /api/staging/nest`, tombol di `components/staging-area/ControlPanel.tsx`, dan handler di `app/staging-area/page.tsx`. Tes `lib/nesting/staging-start.test.ts`.

**Masalah terbuka.** Di `main` tombol lama masih ada. API legacy masih bisa menyusun nama yang sudah punya baris staging aktif (P0.9, bagian penolakan legacy). Mengunci satu lembar masih menandai seluruh resi selesai. Tidak ada login.
