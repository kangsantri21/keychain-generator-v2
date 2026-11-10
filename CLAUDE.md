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
