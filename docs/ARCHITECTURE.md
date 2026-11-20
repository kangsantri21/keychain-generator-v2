# Arsitektur — Keychain Generator v2

Dokumen ini menjelaskan susunan kode di `main`, ditambah bagian yang hanya hidup di `feature/nesting-v3-compact`. Baca bersama `docs/PRD.md`.

## Gambaran

Satu aplikasi Next.js (App Router) versi 16.2.10, React 19, TypeScript ketat. Data disimpan di satu file SQLite lewat Drizzle ORM dan `better-sqlite3`. Tidak ada server terpisah dan tidak ada antrean latar. Hampir semua kerja berat (font, garis potong Clipper, nesting) terjadi saat permintaan API atau saat halaman dimuat.

```
Browser (halaman di app/)
    → route handler di app/api/
        → lib/ (gambar, nesting, ekspor)
        → lib/db (SQLite)
    → file unduhan DXF / JPG dibuat di browser dari data yang sudah dirender
```

Tidak ada `middleware.ts`. Tidak ada pemeriksaan login di route mana pun.

## Struktur folder

| Folder | Isi |
| --- | --- |
| `app/` | Halaman dan API. Satu folder per halaman. |
| `app/api/` | Route JSON: template, pesanan, staging, batch, mahar. |
| `components/` | Form, antrean, kanvas staging, mahar, template. |
| `lib/` | Mesin gambar, nesting, ekspor, skema database. |
| `lib/db/` | `schema.ts` (ganci) dan `mahar-schema.ts` (mahar). |
| `drizzle/` | 18 migrasi SQL (`0000` sampai `0017_shape_block_rotation`, kolom `staging_items.rotation_deg`). Tidak dijalankan otomatis saat aplikasi nyala. |
| `public/uploads/` | Font, gambar karakter, dan thumbnail. Diabaikan git. |
| `public/logo.png` | Logo Kedai Creative. |

Halaman:

| Alamat | Peran |
| --- | --- |
| `/` | Dashboard |
| `/master-template` | Katalog template |
| `/input-pesanan` | Form resi |
| `/order-queue` | Antrean dan pemicu nesting |
| `/staging-area` | Pratinjau lembar, HPP, kunci batch |
| `/file-siap-cetak` | Unduh DXF dan JPG |
| `/mahar-generator` | Input plakat mahar |
| `/mahar-nesting` | Nesting mahar di browser |

State layar kecil ada di Zustand (`lib/store/useTemplateStore.ts`): halaman aktif dan salinan antrean. Sumber kebenaran pesanan tetap database.

## Struktur data

Satu file SQLite. Lokasi bawaan `sqlite.db` di folder proyek, atau path di `DATABASE_URL`. Mode jurnal WAL dihidupkan. **Foreign key SQLite tidak dihidupkan** di `lib/db/index.ts`, walaupun beberapa komentar mengira sebaliknya. `ON DELETE CASCADE` di skema jadi tidak jalan sampai pragma itu dihidupkan.

### Gantungan kunci

- `templates` — kode unik, jenis, path file, warna, mode `dynamic` atau `fixed`, zona teks/gambar, lubang, offset, tinggi target.
- `orders` — satu resi (`receiptCode` unik), kode manual, status `pending` / `processing` / `completed`.
- `order_items` — template, daftar nama (JSON), varian `keychain` atau `pin`, jumlah, override lubang per indeks nama, `batchId` terakhir.
- `staging_items` — satu potongan yang sudah disusun: resi, template, nama, nomor lembar, posisi, ukuran, rotasi, status, snapshot override lubang.
- `print_batches` — batch terkunci. `layoutData` adalah JSON beku (garis, teks, gambar) supaya file tetap bisa diunduh walau template nanti berubah. Status tipe `pending` / `printed` / `archived`, tetapi kode hanya pernah menulis `pending`.

Nomor lembar (`sheetId`) bukan tabel sendiri. Nilainya `MAX(sheetId) + 1` saat nesting baru.

### Bahan Mahar

`mahar_orders` dan `mahar_batches`. Tidak ada tabel staging. Layout dihitung ulang di browser dari pesanan pending, lalu disimpan hanya saat dikunci. Tidak ada foreign key ke tabel ganci.

## Alur data gantungan kunci

1. **Unggah template.** `POST /api/templates` menulis file ke `public/uploads/` dan baris `templates`. Nama file dari kode yang dislug + waktu, bukan nama asli file.
2. **Simpan pesanan.** `POST /api/orders` menulis `orders` dan `order_items` dalam satu transaksi. Kode resi ganda ditolak.
3. **Susun.** `POST /api/staging/nest` menerima daftar `itemId:indeksNama`. Untuk tiap nama, server memuat font dan gambar, menghitung garis potong, lalu `packMaxRects` di `lib/nesting.ts` menaruh kotak di lembar 310×470 mm. Jarak kanan 2 mm, jarak bawah 5 mm (ruang label resi). Hasilnya disisipkan ke `staging_items`. Status resi menjadi `processing`. Di `main`, langkah simpan dan ubah status tidak dalam satu transaksi, dan nama yang sudah staged tidak ditolak.
4. **Lihat lembar.** `GET /api/staging` membaca baris staging lalu **menggambar ulang setiap item** (font + Clipper) supaya kanvas punya path. Riwayat (`?history=1`) dipisah karena gambar ulang itu berat.
5. **Kunci.** Browser mengirim salinan item ke `POST /api/print-batches`. Di `main`, server menyimpan JSON itu, menandai semua resi di dalamnya `completed`, dan menghapus `staging_items` lembar itu. Server tidak menghitung ulang posisi dari database.
6. **Unduh.** Halaman File Siap Cetak memakai `lib/export-dxf.ts` dan `lib/export-print-svg.ts` di browser. JPG dicerminkan horizontal karena cetak dari belakang akrilik.

`POST /api/staging/sheets/[id]/append` menaruh nama baru di sisa ruang tanpa menggeser yang sudah ada. Hanya resi pending.

`POST .../complete` menandai lembar dan semua resinya selesai tanpa membuat batch.

`DELETE .../sheets/[id]` menghapus item lembar itu dan memaksa semua resinya kembali ke pending.

Menghapus resi (`DELETE /api/orders/[id]`) ikut menghapus item pesanan dan item staging resi itu. Resi selesai ditolak.

## Mesin gambar dan nesting

- `lib/keychain-render.ts` — mode dinamis. Teks dari font, garis potong dengan Clipper, lubang cincin, batas lebar 80 mm.
- `lib/clipper-outline.ts` — `computeProductionOutline`. Ini padanan Contour CorelDRAW ke luar, 1 langkah, lalu penutup ceruk: gabungkan bentuk, buang lubang dalam huruf, geser keluar `OUTLINE_OFFSET_MM` (2,5 mm, yaitu 0,25 cm) dengan sambungan bulat. Celah yang lebih sempit dari 5 mm menyatu karena offset itu. Sesudahnya tiap keping ditutup dengan closing bundar selebar `GAP_CLOSE_MM` (bawaan 2 mm, radius 1 mm) supaya hanya ujung ceruk yang runcing jadi busur kecil. Lekukan luar yang lebih lebar tidak dihaluskan. Pinggiran luar tidak bergeser dan spasi kata yang sudah terpisah tidak tersambung. Pratinjau memakai fungsi yang sama, satuannya piksel. Mode tetap tidak memanggil offset ini. Sambungan washer/karakter hanya difillet `SEAM_ROUND_MM` (0,6 mm), tanpa offset kedua.
- `lib/export-dxf.ts` — garis potong menjadi polyline dengan simpangan kurva paling besar `CURVE_TOLERANCE_MM` (0,01 mm), sambungan bulat. Lubang gantungan yang masih berupa lingkaran ditulis sebagai entity `CIRCLE`, termasuk setelah path-nya diubah paper.js menjadi kurva kubik dan setelah keping diputar 90 derajat.
- `lib/keychain-render-fixed.ts` — mode tetap. SVG master sudah punya garis potong. Aplikasi hanya menaruh teks atau foto di zona.
- `lib/render-dispatcher.ts` — memilih renderer sesuai `layoutMode`.
- `lib/nesting.ts` — MaxRects, skor Best-Short-Side-Fit, jika seri dipakai Bottom-Left, barang besar didahulukan, rotasi 90° boleh. Algoritma ini juga dipakai mahar. Jangan diubah sembarangan. Komentar di file itu mencatat kegagalan nyata (lubang di tengah lembar, baris mati, tumpukan satu kolom) yang sudah dilewati.
- `lib/staging-transform.ts` — rotasi gambar dan posisi label resi per item.
- `lib/mahar-geometry.ts` dan `lib/mahar-dxf.ts` — bentuk plakat dan ekspor potong. Teks mahar tidak dipotong laser huruf per huruf.

Ukuran lembar ganci: 310×470 mm (`lib/keychain-geometry.ts`). Empat tanda kamera (fiducial) ada di DXF dan di file cetak. Itu sudah sesuai tanda registrasi di empat sudut pada [contoh penataan manual](reference/contoh-nesting-manual.jpg).

Keputusan produk untuk susunan lembar ada di `docs/PRD.md`: hemat bahan, satu resi satu kelompok, kerapatan maksimal, item boleh diputar. Gambar manual menunjukkan bentuk kelompok yang diinginkan (bingkai, satu kode resi di samping, kolom nama, putaran 90 dan 180 derajat). Mesin di `main` hanya memutar kotak 90 derajat dan tidak membaca nomor resi. Mesin kotak di branch mengelompokkan resi dan memutar 90 derajat.

Kontur tokoh tidak lagi memakai garis potong yang tersimpan di SVG. Garis itu kontur lama. `lib/character-cut.ts` menghitung kontur 2,5 mm dari gambar. Lembar yang sudah tersusun dengan ukuran lama harus dibongkar lalu disusun ulang; layar Staging mengatakan itu saat lebar atau tinggi tidak cocok. Tiga resi yang tersimpan di dua lembar sekaligus juga ditolak, dan pesannya menyebut nomor lembar yang lain.

Sesi susunan blok (di atas kontur 2,5 mm, belum di `main`) menambah jalan lain di `runProductionNesting`: kalau keping membawa garis potong, yang jalan adalah `lib/nesting/shape-block-nesting.ts`. Keping dirapatkan sampai jarak `CUT_CLEARANCE_MM` (bawaan 1 mm) antar garis potong, jadi kotaknya boleh saling tindih selama potongannya tidak. Arah keping dan blok dipilih supaya tinggi lembar paling pendek, bukan supaya nama panjang selalu tegak. Bingkai dan satu kode resi dihitung ulang di `lib/nesting/shape-block-marks.ts` dan ikut file cetak. File laser tidak memuat kode resi. Sudut keping disimpan di kolom `staging_items.rotation_deg` (0, 90, 180, atau 270). Baris lama yang kolomnya kosong tetap dibaca seperti dulu: `rotated` berarti 90°. Status barisnya `staged-shape`. Angka pemakaian bahan ada di [docs/nesting/PENGUKURAN.md](nesting/PENGUKURAN.md).

## Integrasi

| Sistem | Keadaan |
| --- | --- |
| Shopee, TikTok Shop | Tidak ada. Resi diketik manual. |
| BigSeller | Tidak ada. |
| Accurate | Tidak ada. |
| Printer / laser | Lewat file unduhan, bukan API mesin. |
| Login `better-auth` | Ada di `package.json`, tidak ada satupun pemanggilan di kode. |

Tidak ada variabel lingkungan wajib selain `DATABASE_URL` yang opsional. Tidak ada file `.env` di git.

## Keputusan teknis yang sudah diambil

- **SQLite satu file**, bukan Postgres. Cukup untuk satu komputer produksi. Tidak untuk banyak instance.
- **Migrasi Drizzle manual** (`npm run db:migrate`). Aplikasi tidak memigrasi sendiri saat boot. Skema dan database bisa selisih jika langkah ini lupa.
- **Gambar disimpan di `public/uploads`**, bukan di database. Git mengabaikan folder itu. Cadangan database saja tidak cukup. File unggahan harus ikut dicadangkan.
- **Batch menyimpan layout beku** supaya unduhan tidak berubah saat template diedit.
- **Override lubang disalin ke staging** saat nesting, supaya edit belakangan tidak menggeser lembar yang sudah disusun.
- **Mahar dipisah di tabel dan halaman**, tetapi satu proses Node dan satu file database. Komentar skema menyebut ini “terpisah 100%” pada tingkat modul, bukan server kedua.
- **Nesting mahar di browser** karena ukuran plakat sudah diketahui dari preset. Nesting ganci di server karena ukuran baru ada setelah font dirender.
- **`paper` ditandai `serverExternalPackages`** di `next.config.ts` supaya bundler tidak tersandung `jsdom` yang tidak terpasang.
- **Debounce slider** di form template supaya Clipper tidak dihitung ulang tiap geseran piksel.

## Ada di branch, belum di main

Semua berkas di bawah ini hanya ada di `feature/nesting-v3-compact` (dan sebagian fondasinya di `feature/nesting-v2`). `main` tidak memuatnya.

### Nesting V2 (`feature/nesting-v2`, ikut terbawa di v3)

`lib/nesting/grouped-nesting*.ts` dan `outer-maxrects.ts`.

Tiap resi dikelompokkan dulu. Item dalam satu resi disusun rapat (jarak antar-item 2 mm). Kotak kelompok itu lalu disusun di lembar (jarak antar-resi bawaan 8 mm, margin lembar 5 mm). `packMaxRects` lama tidak diubah. Dipanggil sebagai kotak hitam supaya mahar tetap aman. Di antrean, mode ini pratinjau saja: tidak menulis `staging_items`.

### Production Nesting (hanya v3)

- `lib/nesting/production-nesting.ts` menjalankan V2, lalu perbaikan V3 yang hanya dipakai jika hasilnya sah dan benar-benar lebih rapat: slot reflow, geser kelompok terbatas, region repack mode FAST (bukan DEEP). Setelah itu kelompok digeser kaku ke kiri/atas.
- Aturan produksi tetap: lembar 310×470, jarak item 2 mm, jarak antar-resi 2 mm di kedua sumbu, margin kiri 5 mm dan atas 13 mm, satu resi tidak dipecah ke dua lembar.
- `lib/production-gate.ts` menolak tumpang tindih, item di luar lembar, ukuran berubah, resi terpecah, dan tabrakan dengan fiducial.
- `lib/receipt-labels.ts` menaruh label setelah layout final. Jika tidak ada celah aman, label dilewati. Layout tidak dibatalkan hanya karena label.
- `lib/active-frame.ts` memendekkan tinggi ekspor jika isi tidak penuh.
- `lib/staging-mode.ts` menulis status `staged-production` lawan `staged`, tanpa kolom database baru.
- `lib/staging-cache.ts` menyimpan salinan lembar di browser. Bukan sumber kebenaran. Kunci batch tetap membaca database.
- `POST /api/staging/nest` dengan `mode: "production-v3"` menolak resi yang sudah punya item aktif (HTTP 409) dan menolak hasil yang tidak lolos gate (HTTP 422). Penulisan staging dan ubah status ada dalam satu transaksi, dicek lagi di dalam transaksi. Pada sesi susunan blok, permintaan ini mengirim garis potong ke packer baru dan menulis status `staged-shape` plus `rotation_deg`. Packer kotak tetap dipakai jika tidak ada garis potong (tes lama).
- `POST /api/print-batches` mencocokkan kiriman browser dengan baris database, merender ulang untuk cek ukuran, lalu baru menyimpan.
- Perbaikan resi PAT (batch 228) dan `.gitignore` untuk `*.key`, `credentials*.json`, dan `service-account*.json` hanya ada di commit terbaru branch ini.
- Skrip `npm test` menjalankan `tsx --test lib/nesting/*.test.ts lib/contour-outline.test.ts`. `tsx` tidak ditulis sebagai devDependency langsung. Ia ikut terpasang lewat pohon dependensi (Drizzle Kit). Pada audit 10 Nov 2026 suite nesting saja 341 lulus. Setelah sesi kontur, suite yang sama plus 10 tes kontur: 351 lulus. Setelah sesi susunan blok dan perbaikan kontur tokoh serta selang-seling: 371 lulus (`npm test` pada branch ini, 20 November 2026).

`resolveNestingMode` di `lib/nesting/nesting-mode.ts`: selain teks persis `grouped-v2` atau `production-v3`, permintaan dianggap mesin lama. Itu sengaja, supaya pemanggil lama tidak berubah perilaku.
