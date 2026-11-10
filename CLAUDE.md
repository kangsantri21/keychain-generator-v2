@AGENTS.md

# Keychain Generator v2 — ringkasan untuk setiap sesi

Aplikasi internal Next.js milik Rofiq (Kedai Creative) untuk memproses pesanan gantungan kunci akrilik: input resi, antrean, nesting ke lembar 310×470 mm, lalu ekspor DXF (potong) dan JPG (cetak). Ada modul terpisah untuk plakat Bahan Mahar. Detail produk ada di `docs/PRD.md`. Detail teknis ada di `docs/ARCHITECTURE.md`.

Konteks bisnis (Shopee, TikTok Shop, BigSeller, Accurate, dan merek lain) dijelaskan di PRD. Kode saat ini belum terhubung ke sistem itu. Pesanan diketik manual.

## Cabang

- `main` adalah dasar yang sudah rilis sebagai nesting lama (tag `nesting-v1-stable`). Tidak punya tes.
- `feature/nesting-v2` menambah nesting per resi, baru pratinjau, belum dipakai produksi. Ada di atas `main`.
- `feature/nesting-v3-compact` adalah yang paling mutakhir. Isinya semua commit `main` dan `nesting-v2`, plus mesin produksi, perbaikan resi PAT, dan 341 tes. Tag `production-nesting-v1-stable` ada di sini, belum di `main`.

Fitur yang hanya ada di `feature/nesting-v3-compact` harus ditulis jelas sebagai **ada di branch, belum di main**. Jangan dianggap sudah dipakai di `main`.

## Aturan kerja

1. Setiap sesi fitur wajib membaca `docs/PRD.md` dan `docs/ARCHITECTURE.md` sebelum mengubah kode, lalu memperbarui kedua dokumen itu setelah selesai. Jika temuan audit atau urutan kerja berubah, perbarui juga `docs/AUDIT.md` dan `docs/ROADMAP.md`.
2. Satu fitur per sesi, satu branch, satu pull request. Jangan mencampur perbaikan yang tidak berhubungan.
3. Jangan pernah commit `.env`, API key, token, file kredensial, atau database `sqlite.db`. `.gitignore` di `main` sudah mengabaikan `.env*`. Aturan tambahan untuk `*.key` dan file kredensial baru ada di branch `feature/nesting-v3-compact`, belum di `main`.
4. Jangan mengubah kode aplikasi hanya untuk “merapikan”. Perbaikan produksi yang sudah ada di `feature/nesting-v3-compact` jangan ditulis ulang di `main`. Bawa branch itu lewat PR terpisah.
5. Sebelum mengubah API Next.js, baca panduan di `node_modules/next/dist/docs/` (lihat `AGENTS.md`). Versi Next di repo ini punya perbedaan dari versi lama.
6. `README.md` masih teks bawaan Create Next App. Jangan dihapus diam-diam. Jika diganti, pindahkan informasi yang masih benar ke `docs/`.

## Cabang ulasan `versi-lengkap`

Branch ini untuk ditinjau Rofiq. Dasarnya `feature/nesting-v3-compact` pada commit `024e942`, ditambah isi PR #2 (`cursor/kontur-halus-0ae8`: garis potong 2,5 mm, sambungan bulat). PR #3 (`cursor/nesting-blok-bentuk-8dbc`: nesting mengikuti bentuk dan kolom `rotation_deg`) tidak ikut. Dokumen induk di `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/AUDIT.md`, dan `docs/ROADMAP.md` tetap dipakai.

## Menyalakan aplikasi

Database dan unggahan tidak ada di GitHub. `.gitignore` mengabaikan `.env`, `sqlite.db`, `sqlite.db-wal`, `sqlite.db-shm`, dan `public/uploads`. Salin dari Google Drive Rofiq, folder **Mastre Bot Ganci Sebelum Grox / keychain-generator-v2**. Pakai ketiga berkas database yang ada di root folder itu (salinan Oktober). Jangan dicampur dengan salinan September yang terpisah. Salin ketiganya bersama-sama: berkas WAL lebih baru daripada `sqlite.db`, dan SQLite butuh keduanya.

1. `git checkout versi-lengkap`
2. `npm ci`
3. Salin `sqlite.db`, `sqlite.db-wal`, dan `sqlite.db-shm` ke root repo.
4. Salin folder `public/uploads` dari Drive ke `public/uploads`.
5. `cp .env.example .env` (isinya `DATABASE_URL=sqlite.db`). Jangan commit `.env`.
6. `npm run db:migrate` jika database yang disalin belum memakai migrasi di repo. Skema branch ini sama dengan `main` (sampai `0016_icy_misty_knight`). Tidak ada kolom `rotation_deg`; migrasi itu hanya ada di PR #3 dan tidak ikut branch ini.
7. `npm run dev`

`npm run build` membaca database saat membuat halaman depan. Salin database, atau jalankan migrasi pada database kosong, sebelum build. Build tanpa tabel membuat `sqlite.db` kosong dan gagal dengan `no such table: order_items`.

Jangan pernah commit `.env`, berkas database, `public/uploads`, API key, atau kredensial. Satu-satunya berkas env yang boleh masuk Git adalah `.env.example`.

## Keputusan Rofiq — susunan lembar (10 November 2026)

1. Jarak antar potongan tetap 1 mm dulu (`CUT_CLEARANCE_MM` di `lib/nesting/shape-block-config.ts`).
2. Nama panjang tidak wajib tegak. Arah 0/90/180/270 dipilih hanya untuk menghemat bahan.
3. Luas cetak 31 × 47 cm (310 × 470 mm).

Angka pembanding dengan foto manual ada di `docs/nesting/PENGUKURAN.md`.
