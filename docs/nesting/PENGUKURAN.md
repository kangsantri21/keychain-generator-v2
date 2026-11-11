# Pengukuran susunan lembar

Tanggal: 11 November 2026. Belum digabung ke `main`.

Patokan: foto lembar manual Rofiq, [contoh penataan manual](../reference/contoh-nesting-manual.jpg).

## Keputusan Rofiq

1. Jarak antar potongan **1 mm**.
2. Nama panjang tidak wajib tegak. Arah dipilih hanya untuk menghemat bahan.
3. Luas cetak **31 × 47 cm**.
4. Tinggi keping sungguhan: nama saja **2,6 cm**. Tokoh di depan nama **2,9 cm**.

## Font

Foto manual paling dekat dengan Glossy Sheen Shine atau Coffee Soda. Glossy Sheen Shine hanya untuk pemakaian pribadi, jadi tidak dipakai. Coffee Soda (Khurasan) ditulis bebas untuk pemakaian pribadi dan komersial. File-nya ada di `local-fonts/` dan **tidak ikut commit**. Darling Coffee, Choco Shake, dan Buycat tidak punya lisensi yang jelas untuk disimpan di repo.

## Angka

63 keping, 7 resi. Kontur 2,5 mm. Nama jadi 26 mm (contoh Ammara 115,5 × 26,0 mm). Tokoh plus nama sekitar 28–29 mm tinggi, bentuk kepala dan bahu yang menempel ke huruf pertama.

| Susunan | Lembar | Tinggi isi | Catatan |
| --- | --- | --- | --- |
| Foto manual | 1 | 470 mm | lembar penuh, sisa tepi sekitar 6 mm |
| Aplikasi | 2 | 736,1 mm | 78,3% dari dua lembar; isi 74,5% di dalam tinggi itu |

Aplikasi memakai **56,6% lebih banyak panjang** daripada foto (736,1 dibanding 470). Itu di atas batas 10%.

Penyebabnya ukuran. Di foto, tinta huruf di kolom Ammara terukur sekitar **16 mm** tinggi jika gambar itu dianggap lembar 310 × 470 mm utuh. Pada 2,6 cm, 18 nama seperti Ammara (lebar sekitar 11 cm) tidak muat dalam satu kolom setinggi 47 cm, jadi satu resi saja sudah selebar hampir satu lembar. Luas semua keping butuh sekitar 70 cm panjang lembar. Dua lembar adalah batas rapat untuk ukuran ini, bukan tiga.

Gambar skala sama (1 piksel mewakili milimeter yang sama). Kiri foto, kanan dua lembar aplikasi:

[images/manual-vs-aplikasi.png](images/manual-vs-aplikasi.png)

Lembar aplikasi pertama: [images/manual-real-aplikasi.png](images/manual-real-aplikasi.png)

![Perbandingan](images/manual-vs-aplikasi.png)

## Yang sudah dirapatkan

Di dalam blok, keping boleh masuk ke lekukan tetangga (jarak diukur pada garis potong, termasuk putaran 180°). Blok yang tersisa digeser ke lembar sebelumnya kalau masih ada strip kosong. Sisa boros yang besar bukan dari baris yang longgar, melainkan dari keping 2,6 cm yang lebih besar daripada huruf di foto.

## Cara mengulang

`npx tsx scripts/measure-manual-real.ts`

Font dibaca dari `local-fonts/CoffeeSoda.ttf`.
