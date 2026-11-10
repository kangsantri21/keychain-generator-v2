# PRD — Keychain Generator v2

Dokumen ini menjelaskan tujuan produk, siapa yang memakai, alur kerja, dan status fitur. Sumbernya adalah kode di `main` (commit `2cdd700`, tag `nesting-v1-stable`) ditambah isi branch `feature/nesting-v2` dan `feature/nesting-v3-compact` yang belum masuk `main`. Tanggal audit: 10 November 2026.

## Tujuan produk

Tim produksi Kedai Creative butuh cara cepat untuk mengubah pesanan gantungan kunci akrilik menjadi file yang siap dipotong laser dan dicetak. Satu resi bisa berisi banyak nama. Setiap nama punya bentuk potong yang berbeda karena teks dan gambarnya berbeda. Menyusun bentuk itu di lembar akrilik secara manual lambat dan boros bahan.

Aplikasi ini membantu tiga hal:

1. Menyimpan template desain dan pesanan (resi, nama, varian ganci atau pin).
2. Menyusun (nesting) potongan ke lembar akrilik 310×470 mm.
3. Mengunci lembar itu menjadi batch, lalu mengunduh DXF untuk laser dan JPG untuk printer.

Modul kedua, Bahan Mahar, membuat plakat mahar pernikahan dengan alur yang sama secara garis besar, tetapi tabel, API, dan halamannya terpisah.

## Konteks bisnis

Ini konteks dari pemilik, bukan dari kode. Bisnisnya souvenir custom di Shopee dan TikTok Shop. Merek yang disebut: kedaicreative, BKC Trophy, Masterganci, Pehapik, Meera Living, Asikie, dan Griya Unik. Tim memakai BigSeller untuk operasional marketplace dan Accurate untuk pembukuan.

Di dalam kode, yang terlihat hanya nama **Kedai Creative** pada sidebar dan logo. Tidak ada sambungan ke Shopee, TikTok Shop, BigSeller, atau Accurate. Nomor resi diketik sendiri.

## Pengguna

Satu jenis pengguna: operator internal di komputer produksi. Tidak ada akun, peran admin, atau peran operator. Siapa pun yang bisa membuka alamat aplikasi bisa melihat nama pelanggan dan mengubah data.

Pengguna tipikal:

- Admin yang memasukkan template dan pesanan dari resi marketplace.
- Operator yang memilih pesanan, menyusun lembar, mengunci batch, lalu mengunduh file ke mesin laser dan printer (alur cetak yang disebut di kode: Xerox C70, cetak di belakang akrilik).

## Alur kerja pesanan

Alur yang benar-benar ada di aplikasi hari ini:

1. **Template.** Admin mengunggah font (TTF/OTF) dan, untuk template karakter, gambar SVG atau PNG. Admin mengatur warna, tinggi potong, jarak teks, dan apakah ada lubang gantungan. Template bisa mode dinamis (garis potong dihitung aplikasi) atau mode tetap (garis potong sudah ada di SVG).
2. **Input pesanan.** Operator mengetik nomor resi, kode manual jika ada, memilih template, dan menempel daftar nama. Jumlah pesanan sama dengan jumlah nama. Varian: gantungan kunci atau pin. Status awal: pending.
3. **Antrean.** Satu baris per nama. Operator memilih nama yang akan disusun, lalu mengirim ke mesin nesting. Bisa juga menambahkan nama pending ke lembar yang sudah ada.
4. **Staging.** Aplikasi menyimpan posisi tiap potongan di lembar. Operator melihat pratinjau, menghitung HPP kasar (modal lembar dibagi jumlah pcs, tersimpan di browser), lalu mengunci lembar menjadi batch. Ada juga tombol tandai selesai dan bongkar lembar.
5. **File siap cetak.** Batch yang terkunci bisa diunduh sebagai DXF (garis potong, lubang, border, fiducial) dan JPG 300 DPI (gambar cetak, dicerminkan karena cetak dari belakang). Menghapus batch hanya menghapus arsip file. Pesanan tetap berstatus selesai.

Status pesanan di `main`: `pending` → `processing` (setelah masuk lembar) → `completed` (setelah lembar dikunci atau ditandai selesai). Status ini milik seluruh resi, bukan per nama.

Modul mahar: input nama pengantin, tanggal, nominal teks, bentuk, dan ukuran. Nesting mahar dihitung di browser. Hanya hasil yang dikunci yang disimpan ke server.

### Yang berubah di branch nesting-v3-compact

**Ada di branch, belum di main.**

- Antrean punya tiga mode: Production Nesting (bawaan), Legacy Flat (mesin `main`), dan pratinjau Grouped V2 (tidak menulis ke database).
- Mode produksi menolak resi yang sudah ada di lembar kerja, supaya satu resi tidak tercetak dua kali (perbaikan kasus PAT).
- Satu resi disusun sebagai satu kelompok dan tidak dipecah ke banyak lembar.
- Label resi produksi diletakkan di ruang kosong di dalam kelompok, setelah posisi potongan selesai. Label tidak menggeser potongan.
- Mengunci batch dicek ulang ke database. Layout dari browser yang tidak cocok ditolak.
- Lembar produksi bisa memakai tinggi aktif yang lebih pendek dari 470 mm jika isi lembar tidak penuh, supaya bahan tidak terbuang. Ekspor mengikuti bingkai itu.

## Daftar fitur dan status

Status di kolom “Main” adalah yang ada di branch `main` hari ini. Kolom “Branch” hanya diisi jika perilaku di `feature/nesting-v3-compact` berbeda.

| Fitur | Main | Branch nesting-v3-compact |
| --- | --- | --- |
| Dashboard jumlah menunggu, diproses, dan batch | Ada. Angka “menunggu/diproses” menghitung baris item, bukan jumlah resi | Sama |
| Master template karakter dan font | Ada. Mode dinamis dan tetap, warna, lubang, offset huruf, sampul katalog | Sama |
| Input pesanan manual | Ada | Sama |
| Edit pesanan | Tombol ada, tetapi hanya pesan “segera hadir” | Sama |
| Hapus resi | Ada, termasuk resi yang sedang diproses. Item di lembar ikut terhapus | Sama |
| Antrean per nama, filter resi, pilih sekelompok | Ada | Ada, plus pemilih mode nesting |
| Override lubang per nama | Ada, hanya selagi pending | Sama |
| Nesting legacy (MaxRects, semua nama dicampur) | Ada. Ini satu-satunya mesin di main | Masih ada sebagai Legacy Flat |
| Nesting per resi (Grouped V2) | Tidak ada | Ada di branch, belum di main. Pratinjau saja, tidak menyimpan lembar |
| Production Nesting (rapat, satu resi satu lembar) | Tidak ada | Ada di branch, belum di main. Ini bawaan antrean |
| Panel eksperimen (slot, compound, region, benchmark) | Tidak ada | Ada di branch, belum di main. Hanya di mode pratinjau |
| Tambah ke lembar yang sudah ada | Ada, hanya pesanan pending, tidak mengacak isi lama | Ada. Lembar produksi tidak boleh ditambah dengan cara legacy |
| Pratinjau staging dan HPP sederhana | Ada | Ada, plus metrik lembar |
| Kunci batch produksi | Ada. Isi layout dipercaya dari browser | Ada di branch, belum di main: layout dicocokkan ke database dan aturan jarak |
| Tandai selesai tanpa membuat file | Ada. Seluruh resi di lembar jadi selesai | Perlu dicek ulang saat digabung; aturan resi utuh sudah lebih ketat |
| Bongkar lembar | Ada. Semua resi di lembar kembali ke pending | Ada |
| File siap cetak, unduh DXF dan JPG | Ada | Ada. Bingkai tinggi aktif untuk lembar produksi |
| Ubah status batch menjadi sudah dicetak / arsip | Tampilan ada, tidak ada tombol atau API | Sama |
| Bahan Mahar (input, nesting, DXF, batch) | Ada, terpisah dari ganci | Sama |
| Login | Tidak ada. Paket `better-auth` terpasang tetapi tidak dipakai | Sama |
| Impor BigSeller / marketplace | Tidak ada | Tidak ada |
| Jurnal Accurate | Tidak ada | Tidak ada |
| Tes otomatis | Tidak ada | Ada di branch, belum di main. 341 tes nesting pada 10 Nov 2026. Sesi kontur menambah 10 tes; `npm test` di branch itu 351 lulus |

## Keputusan nesting

Rofiq sudah memutuskan aturan susun lembar. Empat butir ini mengalahkan kebiasaan kode lama jika keduanya bentrok.

1. Prioritas utama adalah hemat bahan.
2. Item dari resi yang sama harus berdekatan dan menjadi satu kelompok di lembar. Keping resi lain tidak boleh masuk ke tengah kelompok itu.
3. Di dalam dua aturan di atas, kerapatan harus maksimal.
4. Item boleh diputar.

Hemat bahan tidak boleh dicapai dengan mencampur resi. Kelompok tetap utuh, lalu ruang di dalam dan di antara kelompok diisi sepadat mungkin.

Patokan gambarnya ada di repo: [docs/reference/contoh-nesting-manual.jpg](reference/contoh-nesting-manual.jpg). Itu penataan manual tim Rofiq. Hasil mesin nanti dibandingkan dengan gambar ini, bukan dengan pratinjau lama.

Yang terlihat pada contoh, dan karena itu menjadi bagian dari keputusan:

- Satu resi = satu blok berbingkai tipis. Di dalam bingkai hanya keping resi itu.
- Kode resi tercetak sekali, kecil, di samping bingkai (sering tegak mengikuti tepi blok). Contoh yang terbaca di gambar: `260423FVP8THM6`. Bukan satu kode di bawah setiap keping.
- Nama panjang disusun bertumpuk jadi kolom. Karakter yang se-resi disusun rapat di blok yang sama, termasuk bentuk yang beda (nama, tokoh, lencana).
- Keping diputar 90 derajat atau 180 derajat kalau itu membuat blok lebih rapat atau kolomnya sejajar.
- Blok-blok resi disusun memenuhi lembar. Sisa bahan di tepi tipis.
- Empat tanda registrasi (bulatan) ada di empat sudut lembar.
- Sebagian teks tampak terbalik kiri-kanan. Itu sesuai file cetak dari belakang akrilik, bukan susunan yang salah.

![Contoh penataan manual](reference/contoh-nesting-manual.jpg)

### Dukungan kode hari ini

| Aturan | `main` | `feature/nesting-v3-compact` (belum di main) |
| --- | --- | --- |
| Kelompok per resi | Tidak. Packer hanya melihat kotak. Nomor resi tidak dipakai untuk menaruh keping. Nama dari resi berbeda bisa selang-seling. | Ya, pada mode Production. Isi satu resi disusun dulu, lalu kotak kelompok itu ditaruh di lembar. Mode Legacy di antrean branch masih berperilaku seperti `main`. `feature/nesting-v2` sudah mengelompokkan, tetapi hanya pratinjau dan tidak menyimpan lembar. |
| Item boleh diputar | Ya, 90 derajat, per keping. | Ya, 90 derajat, per keping, saat menyusun isi kelompok. Kotak kelompoknya sendiri tidak diputar. Sudut selain 90 derajat tidak ada. |
| Hemat bahan dan kerapatan maksimal | Sebagian. Jarak antar kotak 2 mm ke kanan dan 5 mm ke bawah. Bentuk tidak beraturan (karakter plus nama) menyisakan sudut kosong. | Lebih rapat antar kotak (2 mm di dalam resi dan 2 mm antar resi), dan susunan yang dipilih mengutamakan sisa lembar di bawah yang masih selebar penuh. Tetap kotak pembungkus, bukan garis potong. Lekukan di dalam kelompok tidak terisi. |

### Celah terhadap keputusan

1. Di `main` keputusan kelompok belum terpenuhi sama sekali. Perbaikan yang ada hanya di branch.
2. Di branch, kelompok sudah ada, tetapi kerapatan belum maksimal: yang dirapatkan kotak, bukan bentuk potong. Sudut kosong di dalam kotak kelompok tidak bisa dipakai keping mana pun.
3. Rotasi keping 90 derajat sudah ada di `main` dan di branch. Rotasi satu kelompok sebagai blok tidak ada. Jika contoh manual memutar sekelompok resi, atau memutar keping selain 90 derajat, itu celah baru.
4. Mode produksi di branch menolak memecah satu resi ke dua lembar. Resi yang lebih besar dari lembar gagal disusun, bukan dilanjutkan sebagai kelompok kedua. Contoh manual yang memecah resi besar akan menunjukkan apakah aturan ini boleh tetap.
5. Gambar patokan sudah ada, tetapi mesin belum diukur terhadapnya. `main` tidak menghasilkan blok berbingkai. Mode produksi di branch mengelompokkan kotak dan bisa memutar 90 derajat, tetapi tidak memutar 180 derajat, tidak menggambar bingkai, dan label resinya tidak diletakkan di samping blok seperti pada gambar. Rinciannya ada di `docs/AUDIT.md`.

## Pertanyaan yang masih terbuka

Yang belum diputuskan ada di bagian nesting. Jawaban kontur sudah ditulis di bawah.

### Nesting

1. Ukuran lembar di kode 310 mm × 470 mm. Apakah itu ukuran akrilik yang dipakai, atau contoh manual memakai ukuran lain?
2. Jarak aman minimum antar garis potong berapa milimeter? Kode belum mengukur jarak antar garis potong. Yang dijaga baru jarak antar kotak: di `main` 2 mm ke kanan dan 5 mm ke bawah. Di mode produksi branch, 2 mm.
3. Resi yang tidak muat dalam satu lembar: boleh lanjut ke lembar berikutnya sebagai kelompok baru, atau harus ditolak?
4. Berapa lama operator masih mau menunggu untuk satu gelombang (misalnya 30 nama, atau batch sebesar PAT 228)?
5. Label nomor resi di bawah setiap keping, atau satu label per kelompok?

### Garis potong (kontur)

Rofiq menjawab pada 10 November 2026. Angkanya ada di `lib/keychain-geometry.ts`. Ukurannya ada di [docs/contour/PENGUKURAN.md](contour/PENGUKURAN.md).

1. Jarak garis potong dari tepi desain = **0,25 mm** (`OUTLINE_OFFSET_MM`). Pada sampel, median terukur 0,25 mm. Mesin lama 2,50 mm.
2. Celah kecil di antara huruf tetap ditutup supaya akrilik tidak putus, tetapi penutupannya terpisah dari offset. Ambang bawaan **6 mm** (`GAP_CLOSE_MM`): celah yang lebih sempit dari itu disambung, lalu baru di-offset 0,25 mm. Enam milimeter dipilih karena pada tinggi teks 20 mm celah antar huruf sampel mencapai sekitar 4,8 mm, sedangkan spasi kata sekitar 10 mm harus tetap terbuka. Audit menulis “di bawah 3 mm”; pengukuran ulang menunjukkan mesin lama sebenarnya menutup celah sampai 8 mm. Ambang 3 mm akan memutus huruf pada sampel, jadi tidak dipakai. Kedua angka bisa diubah di file konstanta itu.
3. Lubang dalam huruf (tengah O) dan mata gambar tetap tidak dipotong. Yang ditutup adalah celah di antara huruf, bukan lubang di dalam satu huruf.
4. Foto PNG tanpa vektor tetap menjadi kotak. Layar template sekarang memperingatkan “bukan vektor”, supaya operator tidak mengira garis potong mengikuti tepi foto.
5. Kurva diratakan dengan simpangan paling besar 0,01 mm. Lubang gantungan 1,9 mm di file DXF ditulis sebagai lingkaran, bukan segi 16.
6. Sampel ukur: huruf O, BOBO, Ali, Siti, Qonita, dan Muhammad Al-Fatih, font DejaVu Sans, tinggi teks 20 mm. Belum ada potongan akrilik sungguhan dari font produksi. Itu yang perlu dicek Rofiq di mesin.

Pertanyaan nesting di atas belum dijawab. Patokan susunan lembar tetap file contoh manual.

## Masalah terbuka

Masalah yang masih mengganggu pekerjaan, baik di `main` maupun yang baru selesai di branch. Dua keluhan pemilik ada di urutan pertama. Rincian algoritmanya ada di `docs/AUDIT.md`.

1. **Hasil nesting belum memenuhi keputusan pemilik.** Prioritasnya hemat bahan, kelompok per resi, kerapatan maksimal, dan item boleh diputar. `main` bisa memutar keping tetapi tidak mengelompokkan resi. Branch sudah mengelompokkan dan memutar 90 derajat, tetapi masih merapatkan kotak. Patokan akhirnya adalah file penataan manual yang belum dikirim.
2. **Garis potong terlalu kasar — perbaikan ada di branch sesi kontur, belum di `main`.** Jarak potong sekarang 0,25 mm, celah antar huruf di bawah 6 mm tetap disambung tanpa menggemukan huruf, dan lubang gantungan di DXF berupa lingkaran. Belum dicek pada potongan akrilik sungguhan. `main` masih mesin lama (gemuk sekitar 2,5 mm, lubang segi 16).
3. **Satu resi bisa masuk dua lembar** di `main`. Antrean masih bisa mengirim nama yang statusnya sudah “diproses”. Perbaikan ada di branch, belum di main.
4. **Mengunci satu lembar menandai seluruh resi selesai.** Nama yang tidak ikut terpilih hilang dari antrean. Di mode produksi branch, resi yang sudah tidak pending tidak bisa dikirim lagi, jadi sisa nama itu tidak punya jalan kembali.
5. **Tombol “Mulai Susun Lembar Kerja” di Staging Area tidak bisa jalan.** Ia memanggil API tanpa daftar nama. Penyusunan yang benar dimulai dari Antrean Pesanan.
6. **Membongkar satu lembar mengembalikan semua resi di lembar itu ke pending**, walaupun bagian resi yang sama masih duduk di lembar lain.
7. **Tidak ada login.** Nama pelanggan dan file produksi terbuka bagi siapa saja yang kebuka aplikasinya.
8. **Edit pesanan belum ada.**
9. **Status “Sudah Dicetak” di File Siap Cetak tidak pernah berubah** dari pending.
10. **Tidak ada impor dari BigSeller** dan tidak ada kiriman ke Accurate. Semua resi diketik ulang.
11. **Database satu file SQLite** di komputer yang menjalankan aplikasi. Tidak ada cadangan bawaan. Tidak aman untuk dua server sekaligus.
12. **Dokumentasi lama** hanya `README.md` bawaan Create Next App, plus `CLAUDE.md` yang menunjuk ke `AGENTS.md`. Dokumen ini menggantikan peran dokumen produk. `README.md` sengaja tidak dihapus.

## Di luar produk hari ini

Hal berikut bukan bagian aplikasi sekarang dan tidak boleh dianggap sudah ada:

- Sinkron pesanan Shopee atau TikTok Shop.
- Akun banyak orang dengan hak berbeda.
- Nesting bentuk asli (bukan kotak) belum ada. Itu celah kerapatan di keputusan nesting, dikerjakan di roadmap P0.5, bukan fitur terpisah di luar produk.
- Harga jual, ongkir, atau stok bahan yang terhubung ke Accurate.
