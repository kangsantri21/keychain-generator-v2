# Audit Keychain Generator v2

Tanggal: 10 November 2026. Kode aplikasi tidak diubah. Yang dibaca adalah `main` (commit `2cdd700`, sama dengan tag `nesting-v1-stable`) dan branch `feature/nesting-v2` serta `feature/nesting-v3-compact` (ujung `024e942`).

## Hasil tes

| Branch | Perintah | Hasil |
| --- | --- | --- |
| `main` | `npm test` | Gagal segera. Tidak ada skrip `test` dan tidak ada file tes. Exit code 1. |
| `feature/nesting-v3-compact` | `npm test` (`tsx --test lib/nesting/*.test.ts`) | 341 lulus, 0 gagal, 135 suite, sekitar 19 detik. |

`tsx` tidak ditulis sebagai devDependency langsung. Pada instalasi bersih ia ikut dari pohon dependensi, dan skrip itu jalan. Tidak ada GitHub Action.

## Cabang

`feature/nesting-v3-compact` memuat semua commit `main` dan semua commit `feature/nesting-v2`, plus mesin produksi, perbaikan resi PAT, dan `.gitignore` untuk file kunci. Tidak ada commit di `main` yang belum ada di branch itu. Tag `production-nesting-v1-stable` menempel di branch, belum di `main`.

Yang paling mutakhir: `feature/nesting-v3-compact`. `feature/nesting-v2` adalah leluhur yang hanya pratinjau. Jangan dikembangkan lagi. Setelah dokumen ini masuk, gabungkan v3 lewat PR terpisah (roadmap P0.7). Jangan rebase tag.

## Struktur singkat

Next.js 16, React 19, SQLite satu file, Drizzle. Halaman: dashboard, master template, input pesanan, antrean, staging, file siap cetak, dan modul mahar yang tabelnya terpisah. Tidak ada login. Tidak ada sambungan BigSeller, Accurate, Shopee, atau TikTok Shop. Detail ada di `docs/ARCHITECTURE.md` dan `docs/PRD.md`.

## Pembaruan sesi susunan blok

10 November 2026, sesudah audit ini ditulis. Sesi susunan blok (di atas kontur 2,5 mm, belum di `main`) menutup celah bingkai, label di samping, putaran 180°, putaran blok, dan rapatan garis potong. Angkanya di [docs/nesting/PENGUKURAN.md](nesting/PENGUKURAN.md). Paragraf di bawah ini adalah keadaan pada saat audit.

## Nesting dibanding contoh manual

Patokan pemilik: [docs/reference/contoh-nesting-manual.jpg](reference/contoh-nesting-manual.jpg). Keputusan tertulis di PRD: hemat bahan, satu resi satu kelompok, kerapatan maksimal, item boleh diputar.

Pada gambar itu terlihat:

- tiap resi berada dalam satu blok berbingkai tipis,
- kode resi tercetak sekali, kecil, di samping bingkai,
- nama panjang disusun sebagai kolom,
- ada putaran 90 derajat dan 180 derajat,
- blok memenuhi lembar, sisa tepi tipis,
- empat bulatan registrasi di sudut.

### Apa yang mesin lakukan

**`main`.** `POST /api/staging/nest` memanggil `packMaxRects` dengan rotasi 90 derajat diizinkan. Packer mengurutkan kotak dari yang luasnya besar, lalu menaruh dengan skor Best-Short-Side-Fit. Nomor resi hanya menempel sebagai data. Tidak dipakai untuk menaruh keping. Jarak antar kotak 2 mm ke kanan dan 5 mm ke bawah (jalur label per keping). Hasilnya tidak bisa menyerupai contoh: resi bercampur, tidak ada bingkai, kode resi ada di bawah setiap keping, dan jalur 5 mm membuat kolom nama jauh lebih boros daripada contoh.

**`feature/nesting-v2`.** Sudah mengelompokkan per resi (susun isi resi dulu, lalu susun kotak kelompok). Hanya pratinjau. Tidak menulis lembar. Kotak kelompok tidak diputar. Ada di branch, belum di main.

**`feature/nesting-v3-compact`, mode Production.** Mengelompokkan per resi dan menolak resi yang sudah ada di lembar lain (perbaikan PAT). Keping di dalam kelompok boleh diputar 90 derajat. Jarak antar kotak 2 mm. Skor memilih susunan yang tinggi terpakainya paling kecil dulu, supaya sisa di bawah lembar masih selebar penuh. Label produksi satu per resi, diletakkan di ruang kosong di dalam kotak, dan boleh tidak ada jika tidak muat. Pratinjau bisa menggambar kotak kelompok untuk cek jarak. File cetak tidak menggambar bingkai hitam di samping kode resi. Mode Legacy di antrean branch masih mesin `main`.

Empat tanda registrasi sudah ada di DXF dan di file cetak, di `main` maupun di branch. Pada mode produksi, tanda bawah bisa naik jika tinggi lembar dipendekkan. Contoh manual menaruh tanda di sudut lembar yang penuh.

### Celah terhadap contoh

1. **Kelompok.** Tidak ada di `main`. Ada di mode produksi branch, tetapi belum menjadi blok berbingkai pada file yang dicetak.
2. **Label.** Contoh: satu kode kecil di selokan samping bingkai. `main`: satu kode di bawah tiap keping. Branch: satu kode di dalam kotak, di lubang kosong, bukan di samping bingkai. Kalau tidak ada lubang kosong, kode bisa tidak tercetak (`NO_SAFE_INTERNAL_LABEL`) tanpa menggagalkan lembar.
3. **Rotasi.** Keduanya hanya 0 atau 90 derajat. Putaran 90 menukar lebar dan tinggi, itu yang membuat kolom mungkin. Putaran 180 tidak mengubah ukuran kotak, jadi packer tidak pernah memilihnya. Contoh memakai 180 derajat (nama terbaca terbalik atas-bawah di dalam kolom).
4. **Kolom nama panjang.** Tidak ada aturan “nama panjang harus bertumpuk”. Branch mencoba beberapa lebar kelompok, jadi kolom bisa muncul, tetapi tidak diwajibkan. `main` cenderung menghampar.
5. **Kerapatan.** Keduanya merapatkan kotak pembungkus, bukan garis potong. Untuk kolom nama yang memang kotak, itu dekat dengan contoh. Sudut kosong di dalam kotak karakter tidak terisi. Jalur 5 mm di `main` dan tepi atas sekitar 13 mm pada mode produksi lebih boros daripada tepi tipis di gambar. Belum ada angka persen karena daftar ukuran keping pada gambar itu tidak tersimpan sebagai data, hanya fotonya.
6. **Satu resi yang muat tidak dipecah.** Mode produksi menolak memecah resi yang masih muat satu lembar. Resi yang tidak muat setelah semua rotasi dipecah menjadi bagian berbingkai (fitur C, ada di branch, belum di main). Contoh 97 tag (10 Nov 8) menjadi dua lembar. Mengunci satu bagian saja masih ditolak; itu fitur D.

Tes 341 di branch menjaga agar resi tidak terpecah, jarak produksi tidak saling tindih, dan label dalam tidak menggeser keping. Tes itu tidak membandingkan hasil dengan gambar manual, tidak menuntut bingkai, dan tidak menuntut putaran 180 derajat.

## Garis potong

Pembaruan 10 November 2026, sesudah audit ini ditulis: temuan di bawah diverifikasi dengan mengukur kode lama, lalu mesin kontur diubah di branch sesi kontur (belum di `main`). Offset terukur mesin lama 2,50 mm, bukan kira-kira. Celah antar bentuk tertutup sampai 8,0 mm, bukan 3 mm — angka 3 mm adalah konstanta `SEAM_CLOSE_MM`, dan radius itu menutup celah sampai 6 mm. Lubang 1,9 mm pada toleransi 0,05 mm memang 16 sisi, simpangan tali busur sekitar 0,019 mm. Lingkaran jari-jari 10 mm menjadi 48 sisi. Koreksi satuan dari Rofiq: 0,25 cm Corel = 2,5 mm, bukan 0,25 mm. Mesin di branch sesi kontur sekarang offset 2,5 mm dengan sambungan bulat, tanpa closing tambahan yang meratakan ceruk. Lubang DXF berupa lingkaran. Tabelnya di [docs/contour/PENGUKURAN.md](contour/PENGUKURAN.md). Paragraf di bawah ini adalah keadaan pada saat audit, sebelum perbaikan.

Keluhan kedua pemilik: kontur masih kasar. Pada commit yang diaudit, file kontur (`lib/clipper-outline.ts`, `lib/laser-outline.ts`, `lib/keychain-render.ts`, `lib/keychain-geometry.ts`) sama di `main` dan di branch. Branch hanya mengubah tinggi bingkai DXF, bukan bentuk garis.

Cara kerjanya:

1. Kurva huruf dan SVG diratakan jadi garis lurus. Simpangan paling besar 0,05 mm (`FLATTEN_TOLERANCE_MM`).
2. Clipper menggabungkan bentuk, membuang lubang dalam (lubang huruf, mata gambar), lalu menggemukkan dan menyusutkan dengan sambungan bulat.
3. Untuk huruf, gemuk 4 mm lalu susut 1,5 mm. Garis potong jadi sekitar 2,5 mm di luar huruf, dan celah sempit antarhuru tertutup.
4. Setelah karakter disambung ke teks, jejak tutup 3 mm (`SEAM_CLOSE_MM`) menghilangkan lekukan yang lebih sempit dari itu, termasuk di badan karakter. Komentar kode mengatakan ukuran luar tidak berubah. Itu benar untuk bentuk yang besar. Detail kecil tidak kembali.
5. Karakter PNG yang tidak punya vektor menjadi kotak, lalu kotak itu digemukkan.
6. DXF menyimpan garis lurus, bukan kurva. Lubang diameter 1,9 mm yang diratakan pada 0,05 mm terukur sekitar 16 sisi. Lengkung besar (jari-jari 10 mm) sekitar 48 sisi. Yang kecil terlihat patah. Busur sambungan Clipper sendiri sangat halus (toleransi busur bawaan 0,25 satuan pada skala 1000, simpangan sekitar 0,00025 mm). Kekasaran yang terlihat lebih berasal dari ratakan 0,05 mm pada jari-jari kecil dan dari bentuk yang sengaja digemukkan, bukan dari busur Clipper yang kasar.

Parameter yang mengubah halus-kasar dan rapat-longgar: `DILATE_MM` 4, `ERODE_MM` 1,5, `SEAM_CLOSE_MM` 3, `FLATTEN_TOLERANCE_MM` 0,05, dan apakah lubang dalam dibuang. Tidak ada setelan ini di layar.

## Temuan lain

Tingkat keparahan untuk pekerjaan sehari-hari.

| Tingkat | Temuan |
| --- | --- |
| Tinggi | Tidak ada login. Semua API bisa mengubah dan menghapus pesanan. Paket `better-auth` terpasang tetapi tidak dipanggil. |
| Tinggi | `main` bisa menyusun nama yang sama dua kali. Perbaikan satu resi satu lembar hanya di branch. |
| Tinggi | Mengunci atau menandai selesai satu lembar mengubah seluruh resi menjadi selesai, termasuk nama yang tidak ikut. |
| Tinggi | Tombol “Mulai Susun Lembar Kerja” di Staging mengirim permintaan tanpa daftar nama, jadi selalu gagal. **Diperbaiki di branch ini, belum di `main`:** tombol mengirim `allPending`, server mengisi nama dari resi pending, lalu Production Nesting menulis lembar. |
| Sedang | Membongkar satu lembar mengembalikan semua resi di lembar itu ke pending, walaupun bagian resi masih ada di lembar lain. |
| Sedang | Di `main`, kunci batch percaya JSON dari browser. Di branch, posisi dicocokkan ke database. Belum di `main`. |
| Sedang | Foreign key SQLite tidak dihidupkan, padahal komentar kode mengira sebaliknya. |
| Sedang | `npm audit --omit=dev`: 15 temuan, 2 kritis (`next`, `better-auth`), 6 tinggi (termasuk `@xmldom/xmldom`). Aplikasi tidak memakai middleware Next, jadi advisory middleware mungkin tidak kena. `better-auth` tidak dipakai sama sekali. |
| Rendah | Riwayat git tidak memuat `.env`, file kunci, atau pola token yang dicari (`AKIA`, `sk_live`, `ghp_`, private key). Commit terakhir di v3 hanya menambah aturan abaikan `*.key` dan `credentials*.json`. Aturan itu belum di `main`. |
| Rendah | Status batch “sudah dicetak” tidak pernah bisa diubah. Edit pesanan masih toast “segera hadir”. |

Unggahan template tidak dibatasi ukuran. SVG disimpan di `public/` dan bisa berisi skrip jika dibuka langsung. `GET /api/staging` menggambar ulang setiap keping dengan Clipper setiap kali halaman dibuka.

## Rekomendasi cabang

Kerjakan perbaikan nesting dan kontur di atas `feature/nesting-v3-compact`, jangan ditulis ulang di `main`. Gabungkan branch itu setelah P0.7. `feature/nesting-v2` tidak perlu PR sendiri.
