# Pengukuran susunan lembar

Tanggal: 10 November 2026. Mesin baru ada di atas kontur 2,5 mm. Belum digabung ke `main`.

Patokan: foto lembar manual Rofiq, [contoh penataan manual](../reference/contoh-nesting-manual.jpg). Bukan susunan tangan buatan mesin.

## Keputusan Rofiq (10 November 2026)

1. Jarak antar potongan tetap **1 mm** untuk sementara (`CUT_CLEARANCE_MM`).
2. Nama panjang tidak wajib tegak. Arah 0°, 90°, 180°, atau 270° dipilih per keping hanya kalau itu menghemat bahan.
3. Luas cetak **31 × 47 cm** (310 × 470 mm).

## Sampel nama sungguhan

63 keping dari 7 resi yang terbaca di foto. Nama lewat kontur aplikasi: tinggi jadi 20 mm, tokoh 26 mm, offset 2,5 mm, tutup takik 2 mm. Font pesanan tidak ada di repo. Yang dipakai Noto Sans Display Bold. Gelas karakter digambar sebagai satu pelat bundar (nama tercetak di atasnya, bukan garis potong kedua). Tokoh plus nama (Mezza, Rasya, dan sejenisnya) adalah lingkaran 26 mm yang disambung ke teks.

Ejaan yang paling dekat dari font gelembung: Rasqa, Hagan, Cleona. Beberapa label gelas di foto terbalik; tetap dihitung satu keping.

## Angka

Manual mengisi satu lembar sampai sekitar 6 mm dari keempat tepi. Praktis satu lembar penuh, tinggi 470 mm.

Aplikasi menaruh keping yang sama di satu lembar dan berhenti pada 382 mm. Sisa di bawah bisa dipotong.

| Susunan | Lembar | Tinggi isi | Panjang lembar | Isi di dalam tinggi itu |
| --- | --- | --- | --- | --- |
| Foto manual | 1 | 470 mm | 100% | lembar penuh |
| Aplikasi (garis potong) | 1 | 382,0 mm | 81,3% | 68,5% |

Aplikasi **18,7% lebih pendek** dari lembar manual. Tidak lebih boros dari batas 10%.

Kalau sisa lembar tidak dipotong dan akrilik selalu dibeli 470 mm, keduanya tetap satu lembar. Hematnya baru terasa saat sisa 88 mm di bawah dipotong.

Gambar berdampingan (kiri foto manual, kanan aplikasi): [images/manual-vs-aplikasi.png](images/manual-vs-aplikasi.png)

Hasil aplikasi saja: [images/manual-real-aplikasi.png](images/manual-real-aplikasi.png)

![Manual dan aplikasi](images/manual-vs-aplikasi.png)

## Yang membuat perbandingan ini belum setara penuh

Gambar tokoh di foto lebih besar dan lebih rumit daripada pelat bundar di hitungan ini. Kalau file SVG tokoh asli dipakai, blok ungu dan biru bisa lebih gemuk, dan selisih 88 mm bisa menyusut. Font gelembung pesanan juga lebih lebar dari Noto Sans Display Bold pada beberapa nama.

## Cara mengulang

`npx tsx scripts/measure-manual-real.ts`

Jarak aman tetap di `lib/nesting/shape-block-config.ts`.
