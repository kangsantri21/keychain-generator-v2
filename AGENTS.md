<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Menyalakan aplikasi (branch `versi-lengkap`)

Database dan unggahan tidak ada di GitHub. `.gitignore` mengabaikan `.env`, `sqlite.db`, `sqlite.db-wal`, `sqlite.db-shm`, dan `public/uploads`. Salin dari Google Drive Rofiq, folder **Mastre Bot Ganci Sebelum Grox / keychain-generator-v2**. Pakai ketiga berkas database yang ada di root folder itu (salinan Oktober). Jangan dicampur dengan salinan September yang terpisah. Salin ketiganya bersama-sama: berkas WAL lebih baru daripada `sqlite.db`, dan SQLite butuh keduanya.

1. `git checkout versi-lengkap`
2. `npm ci`
3. Salin `sqlite.db`, `sqlite.db-wal`, dan `sqlite.db-shm` ke root repo.
4. Salin folder `public/uploads` dari Drive ke `public/uploads`.
5. `cp .env.example .env` (isinya `DATABASE_URL=sqlite.db`). Jangan commit `.env`.
6. `npm run db:migrate` jika database yang disalin belum memakai migrasi di repo. `main` berhenti di `0016_icy_misty_knight`. Branch ini menambah `0017_shape_block_rotation` (kolom `rotation_deg`) dan `0018_receipt_split_part` (`split_part`, `split_count`). Database yang sudah di 0016 cukup di-migrate sampai habis. Baris lama yang kolomnya kosong tetap dibaca seperti dulu.
7. `npm run dev`

`npm run build` membaca database saat membuat halaman depan. Salin database, atau jalankan migrasi pada database kosong, sebelum build. Build tanpa tabel membuat `sqlite.db` kosong dan gagal dengan `no such table: order_items`.

Jangan pernah commit `.env`, berkas database, `public/uploads`, folder `local-fonts` (font Coffee Soda), API key, atau kredensial. Satu-satunya berkas env yang boleh masuk Git adalah `.env.example`.
