# Roadmap perbaikan

Urutan ini mengikuti audit 10 November 2026 dan keputusan nesting di `docs/PRD.md`. Dua keluhan pemilik — garis potong kasar, dan susunan lembar yang belum seperti penataan manual — ada di urutan paling atas. P0 lain menghalangi produksi yang aman. P1 mengurangi kesalahan harian. P2 berguna, tetapi produksi tetap jalan tanpanya.

Patokan susunan lembar adalah [docs/reference/contoh-nesting-manual.jpg](reference/contoh-nesting-manual.jpg). Butir nesting di bawah ini belum selesai sebelum hasilnya dibandingkan dengan gambar itu.

Tiap butir cukup kecil untuk satu sesi, satu branch, dan satu PR. Jangan mengerjakan dua butir dalam satu PR. Sebelum mulai, baca `docs/PRD.md` dan `docs/ARCHITECTURE.md`. Sesudah selesai, perbarui keduanya.

Fitur yang disebut “sudah ada di branch” jangan ditulis ulang. PR-nya adalah menggabungkan `feature/nesting-v3-compact`, lalu merapikan sisa lubang yang branch itu belum tutup.

## P0

### P0.1–P0.2 Garis potong — selesai di branch sesi kontur, belum di `main`

Rofiq sudah menjawab, jadi ukur dan perbaikan dikerjakan dalam satu PR. Tabel dan gambar ada di [docs/contour/PENGUKURAN.md](contour/PENGUKURAN.md).

Yang terukur pada mesin lama, sebelum angka diubah: offset 2,50 mm, celah antar bentuk tertutup sampai 8 mm, lingkaran jari-jari 10 mm menjadi 48 sisi pada toleransi 0,05 mm, lubang 1,9 mm menjadi 16 sisi.

Yang dipakai sekarang:

- `OUTLINE_OFFSET_MM` = 2,5. Itu 0,25 cm di CorelDRAW (Contour ke luar, 1 langkah). Pada enam sampel nama plus “Faza”, median offset 2,50 mm. Sudut cembung adalah busur jari-jari 2,5 mm.
- Celah antar huruf lebih sempit dari 5 mm tertutup oleh offset itu. `GAP_CLOSE_MM` = 2 hanya membulatkan takik yang lebih sempit dari 2 mm. Gelombang luar yang lebih lebar tetap seperti kontur 2,5 mm tanpa closing. Pinggiran luar tetap 2,5 mm. Spasi kata tetap terbuka.
- Lubang dalam huruf O tidak dipotong, sesuai keputusan.
- PNG tanpa vektor memunculkan peringatan di layar template.
- Lubang gantungan di DXF adalah lingkaran. Tes gagal jika offset kotak menyimpang lebih dari 0,03 mm dari 2,5, jika sudutnya bukan busur jari-jari 2,5 mm, jika celah 4 mm tidak tersambung, atau jika lubang DXF bukan `CIRCLE`.

Belum selesai di dunia nyata: potong satu lembar akrilik dengan font produksi dan bandingkan dengan gambar di dokumen ukur. `main` masih mesin lama.

### P0.3 Nesting — patokan gambar manual

Acuan selesai butir P0.4 sampai P0.6 adalah [contoh penataan manual](reference/contoh-nesting-manual.jpg). Jangan mengganti patokan dengan layout hasil mesin sendiri.

Selesai bila:

- File itu tetap di `docs/reference/contoh-nesting-manual.jpg` dan PRD menautkannya.
- Setiap PR nesting yang menyentuh P0.4–P0.6 menempelkan gambar hasil mesin di samping gambar ini untuk satu batch campuran (kolom nama panjang, blok karakter, dan minimal dua resi).

### P0.4 Satu resi satu blok, satu kode resi di samping bingkai — selesai di sesi susunan blok, belum di `main`

Gambar dan angka: [docs/nesting/PENGUKURAN.md](nesting/PENGUKURAN.md).

`main` tidak mengelompokkan resi. Mode produksi di branch sudah mengelompokkan kotak, tetapi file cetak tidak menggambar bingkai dan kode resi diletakkan di ruang kosong di dalam kotak, atau (pada mesin lama) di bawah setiap keping.

Selesai bila, pada batch uji yang polanya sama dengan contoh manual:

- Semua keping satu resi berada di dalam satu bingkai. Tidak ada keping resi lain di dalam bingkai itu.
- Bingkai tipis itu ikut tercetak pada file print.
- Kode resi tercetak tepat satu kali, kecil, di selokan di samping bingkai, bukan di bawah setiap keping. Tes menghitung jumlah label per resi dan gagal jika bukan 1.
- Dua resi pada fixture tes tidak saling seling jika dijalankan lewat mode yang dipakai produksi.

### P0.5 Rotasi 90 derajat dan 180 derajat — selesai di sesi susunan blok, belum di `main`

270° dipakai hanya kalau itu membuat blok lebih pendek. Contoh manual tidak butuh sudut selain kelipatan 90°. Itu dicatat di PRD.

Sekarang keping hanya bisa 0 derajat atau 90 derajat, karena packer hanya menukar lebar dan tinggi. Putaran 180 derajat tidak mengubah kotak, jadi tidak pernah dipilih. Contoh manual memakai keduanya: nama panjang menjadi kolom (90 derajat) dan banyak nama terbaca terbalik atas-bawah (180 derajat).

Selesai bila:

- Satu keping bisa ditempatkan pada 0, 90, dan 180 derajat. 270 derajat dipakai hanya jika itu membuat blok lebih pendek.
- Fixture “delapan nama panjang” tersusun sebagai satu kolom, seperti kolom nama di contoh manual, bukan sebagai satu baris membentang.
- Tes rotasi 180 gagal jika arah gambar tidak benar-benar berputar (bukan hanya kotaknya yang sama).
- Kelompok resi tidak pecah gara-gara diputar.
- Jika contoh manual ternyata butuh sudut selain kelipatan 90, catat di PRD dan jangan pura-pura butir ini sudah menutupnya.

### P0.6 Kerapatan mendekati penataan manual — selesai di sesi susunan blok, belum di `main`

Pada sampel 11 resi, tinggi mesin 195,8 mm. Susunan tangan 223,6 mm. Selisihnya 12,4% lebih hemat, di dalam batas 10% lebih boros. Rapatan mengikuti garis potong, jarak aman 1 mm. Kotak lama pada sampel yang sama 205,0 mm.

Prioritasnya hemat bahan, tanpa memecah kelompok. Contoh manual hampir penuh, sisa tepi tipis, tanda registrasi tetap di empat sudut.

Selesai bila:

- Fixture uji (satu kolom nama panjang, satu kisi karakter, dua resi) punya susunan tangan yang meniru pola gambar, disimpan di tes.
- Tinggi bahan yang terpakai mesin tidak lebih dari 10 persen di atas susunan tangan itu, dan jumlah lembar tidak lebih banyak.
- Jarak antar bingkai tidak lebih besar dari jarak antar bingkai pada susunan tangan.
- Tanda registrasi ada di empat sudut lembar yang diekspor.
- Tes gagal jika mesin mencampur dua resi hanya supaya angka pemakaian naik.
- Jika setelah butir ini selisih masih di atas 10 persen karena yang dirapatkan masih kotak, baru kerjakan rapatan mengikuti garis potong. Jangan mulai dari situ sebelum kolom, rotasi, dan bingkai pada P0.4 dan P0.5 selesai.

### P0.7 Gabungkan nesting produksi ke main

**Ada di branch, belum di main.** `feature/nesting-v3-compact` sudah berisi mesin produksi, cek resi ganda, dan 341 tes.

Selesai bila:

- Ada PR terpisah dari branch itu ke `main` (bukan dicampur dengan dokumen).
- `main` memuat `lib/nesting/production-nesting.ts` dan perbaikan `.gitignore` kredensial.
- `npm test` di `main` lulus, jumlahnya tidak turun dari 341.
- `feature/nesting-v2` tidak dipakai untuk fitur baru setelah PR itu digabung. Branch itu adalah leluhur v3.

### P0.8 Sisa nama dalam satu resi tidak hilang

Hari ini status milik seluruh resi. Memilih sebagian nama lalu mengunci lembar menandai resi selesai. Di mode produksi (branch), sisa nama tidak bisa dikirim lagi karena resi sudah bukan pending.

Selesai bila:

- Dari antrean, operator tidak bisa mengirim sebagian nama sebuah resi pada mode produksi. Pilihan harus satu resi utuh, atau aplikasi yang menolak dengan pesan yang menyebut nama resi.
- Ada tes yang gagal jika hanya sebagian nama resi yang dikirim ke mode produksi.
- Nama yang tidak ikut lembar tetap tampil di antrean sampai benar-benar disusun, atau resi memang sengaja dibatalkan.

### P0.9 Cegah susun ulang dan perbaiki tombol Staging

Di `main`, `POST /api/staging/nest` tidak menolak nama yang sudah ada di lembar. Tombol “Mulai Susun Lembar Kerja” di Staging Area memanggil API tanpa daftar nama, jadi selalu gagal.

Selesai bila:

- API legacy menolak pilihan yang sudah punya baris `staging_items` aktif untuk nama yang sama, dengan pesan yang bisa dibaca operator.
- Tombol di Staging Area dihapus, atau hanya membuka Antrean Pesanan. Tidak ada lagi permintaan nest tanpa `selections`.
- Tes mencakup kedua kasus itu. Untuk mode produksi, tes resi ganda yang sudah ada di branch tetap lulus.

### P0.10 Bongkar lembar tidak merusak lembar lain

`DELETE /api/staging/sheets/[id]` mengembalikan setiap resi di lembar itu ke pending, walaupun resi yang sama masih punya item di lembar lain.

Selesai bila:

- Resi kembali ke pending hanya jika tidak ada lagi item staging aktif untuk resi itu.
- Jika masih ada item di lembar lain, status tetap `processing` dan item di lembar lain tidak berubah.
- Ada tes untuk resi yang terbelah di dua lembar (data lama), lalu satu lembar dibongkar.

### P0.11 Login sederhana untuk alat internal

Tidak ada auth. Paket `better-auth` terpasang tetapi tidak dipanggil.

Selesai bila:

- Semua `POST`, `PUT`, dan `DELETE` di `app/api/` menolak permintaan tanpa sesi (jawaban 401).
- Halaman aplikasi tidak menampilkan data pesanan sebelum login.
- Satu akun bersama untuk tim boleh, asalkan kata sandi tidak disimpan di git dan tidak ditulis di dokumen.
- `better-auth` benar-benar dipakai, atau dihapus dari `package.json` jika diganti cara lain. Jangan membiarkannya sebagai dependensi mati.

### P0.12 Hidupkan foreign key SQLite

`lib/db/index.ts` hanya mengatur `journal_mode = WAL`.

Selesai bila:

- Koneksi menjalankan `pragma foreign_keys = ON` sebelum query lain.
- Tes mencoba menghapus template yang masih dipakai pesanan dan mendapat penolakan, bukan baris yatim.
- Tes mencoba `order_items` dengan `template_id` yang tidak ada dan gagal.
- Perilaku hapus resi yang sudah benar (hapus anak dulu) tetap lulus.

## P1

### P1.1 Kunci batch selalu membaca database

**Sebagian ada di branch, belum di main.** Di `main`, `POST /api/print-batches` menyimpan JSON dari browser.

Selesai bila P0.7 sudah masuk ke `main`:

- Posisi yang disimpan sama dengan baris `staging_items`.
- Kiriman yang tidak cocok ditolak (422) dan tidak mengubah status pesanan.
- Tes gate yang sudah ada di branch berjalan di `main`.

### P1.2 Status batch bisa diubah

Kolom status batch punya nilai “sudah dicetak” dan “arsip”, tetapi tidak ada API untuk mengubahnya.

Selesai bila:

- Operator bisa menandai batch sudah dicetak, dan bisa mengarsipkan.
- Perubahan tercatat di `updatedAt`.
- Menghapus batch tetap tidak mengubah status pesanan (perilaku sekarang dipertahankan).

### P1.3 Edit pesanan pending

Tombol edit di Input Pesanan hanya menampilkan toast.

Selesai bila:

- Resi pending bisa diubah: kode manual, template, nama, varian.
- Resi `processing` atau `completed` ditolak, dengan pesan.
- Kode resi tetap unik.
- Ada tes API untuk tiga status itu.

### P1.4 Batas unggah dan file SVG

Template SVG/PNG/font masuk ke `public/` tanpa batas ukuran. SVG yang dibuka langsung di browser bisa berisi skrip.

Selesai bila:

- File di atas batas yang ditulis di PRD (usul awal: 15 MB per file) ditolak.
- SVG karakter ditolak jika berisi `script`, event handler, atau `foreignObject`, atau disajikan dengan tipe yang tidak dieksekusi.
- Path hapus file tidak bisa keluar dari `public/uploads` walaupun isi database aneh.

### P1.5 Cadangan database dan unggahan

Selesai bila:

- Ada perintah atau tombol admin yang menyalin `sqlite.db` (dalam keadaan konsisten, misalnya `VACUUM INTO` atau cadangan API SQLite) plus folder `public/uploads` ke satu arsip.
- Dokumen PRD menjelaskan cara mengembalikan arsip itu.
- Arsip tidak ikut ter-commit.

### P1.6 CI dan skrip tes yang jujur

**Tesnya ada di branch, belum di main.**

Selesai bila:

- `tsx` tercantum di `devDependencies`.
- GitHub Action menjalankan `npm test` pada PR ke `main`.
- Workflow gagal jika ada tes gagal.
- Setelah P0.7, cabang PR ini memakai suite yang sama.

### P1.7 Dependensi yang berisiko

Audit `npm audit --omit=dev` pada lockfile branch v3 (sama untuk paket runtime `main`): 15 temuan, 2 kritis (`next`, `better-auth`), 6 tinggi (termasuk `@xmldom/xmldom`, `nanoid`, `postcss`, `sharp`).

Selesai bila:

- Next.js dinaikkan ke versi yang menutup advisory middleware/proxy, atau PR mencatat bahwa aplikasi tidak memakai middleware dan advisory itu tidak kena, plus versi tetap dinaikkan jika perbaikan sudah ada.
- `better-auth` dihapus atau diperbarui sesuai P0.11.
- `npm audit --omit=dev` tidak lagi melaporkan tingkat kritis pada dependensi yang benar-benar diimpor.

### P1.8 Jangan gambar ulang seluruh lembar jika tidak perlu

`GET /api/staging` menjalankan Clipper untuk setiap item pada tiap buka halaman.

**Cache layar ada di branch, belum di main.** Cache itu bukan pengganti render server.

Selesai bila:

- Membuka ulang lembar yang sama tidak menghitung ulang Clipper jika template, nama, dan override tidak berubah.
- Setelah edit template, gambar lama tidak dipakai.
- Waktu buka staging untuk 100 item tercatat di PR, sebelum dan sesudah.

### P1.9 Sembunyikan alat eksperimen dari operator

**Ada di branch, belum di main:** panel slot reflow, compound, region, dan benchmark di antrean.

Selesai bila:

- Operator produksi hanya melihat Production dan, jika masih dibutuhkan, Legacy.
- Alat eksperimen hanya muncul jika variabel lingkungan khusus menyala, dan variabel itu tidak di-commit.
- Mode pratinjau tetap tidak menulis database (tes yang sudah ada tetap lulus).

## P2

### P2.1 Impor resi dari BigSeller

Selesai bila:

- Ada cara mengunggah berkas ekspor BigSeller (format kolom didokumentasikan di PRD) yang membuat `orders` dan `order_items` pending.
- Resi yang sudah ada tidak didobel.
- Tidak ada API key di repo. Jika nanti memakai API, kunci hanya di lingkungan mesin.

### P2.2 Catatan ke Accurate

Selesai bila PRD mendefinisikan data apa yang dikirim (bukan hanya “integrasi”), dan percobaan pertama hanya membuat draf yang operator setujui. Jangan mengirim angka keuangan diam-diam.

### P2.3 HPP yang memakai bahan nyata

Kalkulator sekarang adalah modal lembar dibagi jumlah pcs, disimpan di `localStorage`.

Selesai bila harga akrilik dan print bisa disimpan di database (bukan hanya browser) dan HPP per pcs memakai luas yang benar-benar terpakai. Angka default lama 50000 tetap bisa dipakai sebagai titik awal.

### P2.4 Mahar mengikuti gerbang yang sama

Selesai bila mengunci batch mahar menolak layout yang tidak cocok dengan hitungan ulang server, bukan hanya percaya browser. Nesting mahar boleh tetap di browser untuk pratinjau.

### P2.5 Pecah form template

`components/master-template/CharacterTemplateForm.tsx` sekitar 1.250 baris.

Selesai bila form terpecah per bagian (file, warna, lubang, zona) tanpa mengubah field yang disimpan, dan unggah template karakter masih bisa dicoba manual.

### P2.6 Panduan operator di README

`README.md` masih teks Create Next App. Jangan dihapus sebelum penggantinya ada.

Selesai bila README menjelaskan cara memasang, `npm run db:migrate`, `npm run dev`, dan alur singkat resi sampai unduh file, dengan tautan ke `docs/PRD.md`. Tidak berisi rahasia.

## Yang sengaja tidak dijadwalkan

- Mengganti SQLite dengan server database, sampai ada kebutuhan dua komputer menulis bersamaan.
- Mengganti seluruh nesting kotak dengan nesting bentuk bebas, sebelum P0.4 sampai P0.6 selesai. Contoh manual sebagian besar berupa kolom dan kisi. Jika setelah itu pemakaian bahan masih lebih boros dari 10 persen, rapatan mengikuti garis potong masuk ke lanjutan P0.6. `packMaxRects` tetap dipakai mahar. Jangan diubah diam-diam.
- Menulis ulang `packMaxRects` di `lib/nesting.ts`. V2 dan V3 memanggilnya. Perubahan harus lewat tes geometri yang sudah ada.
