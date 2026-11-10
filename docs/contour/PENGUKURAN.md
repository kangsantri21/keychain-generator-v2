# Pengukuran kontur — sebelum dan sesudah

Tanggal: 10 November 2026. Font sampel: DejaVu Sans (font sistem, bukan font gelembung produksi). Tinggi teks jadi 20 mm. Angka “sebelum” memakai mesin lama: gemuk 4 mm lalu susut 1,5 mm, kurva diratakan pada 0,05 mm. Angka “sesudah” memakai mesin baru di `lib/keychain-geometry.ts`: tutup celah di bawah 6 mm, lalu offset 0,25 mm, kurva diratakan pada 0,01 mm. Lubang gantungan di file DXF ditulis sebagai lingkaran, bukan segi banyak.

Gambarnya: [images/perbandingan.png](images/perbandingan.png). Abu-abu adalah huruf. Merah adalah garis potong lama. Biru adalah garis potong baru.

## Verifikasi temuan audit

Diukur ulang pada kode lama, bukan hanya dibaca dari komentar.

| Temuan audit | Hasil ukur |
| --- | --- |
| Huruf digemukkan sekitar 2,5 mm | Kotak lurus dan huruf O sama-sama 2,50 mm di luar tepi desain |
| Lekukan di bawah 3 mm ditutup | Celah antara dua bentuk tertutup sampai 8,0 mm (karena gemuk 4 mm dari tiap sisi). Tutup sambungan lama (radius 3 mm) menutup celah sampai 6,0 mm. Angka 3 mm di audit adalah konstanta kodenya, bukan lebar celah yang terukur |
| Kurva jadi garis lurus pada toleransi 0,05 mm | Lingkaran jari-jari 10 mm menjadi 48 sisi. Simpangan tali busur sekitar 0,05 mm |
| Lubang 1,9 mm sekitar 16 sisi | 16 sisi. Tali busur masuk ke dalam lingkaran sekitar 0,019 mm |

## Lima nama, plus satu nama panjang

Offset adalah jarak median dari garis potong ke tepi huruf, dalam mm. “Keping” adalah jumlah garis potong tertutup. Satu keping berarti huruf dalam kata itu menyambung. Dua keping pada nama panjang adalah spasi kata (sekitar 10 mm) yang sengaja tidak disambung, sama seperti mesin lama.

| Nama | Offset lama | Offset baru | Titik lama | Titik baru | Keping lama | Keping baru |
| --- | --- | --- | --- | --- | --- | --- |
| O | 2,50 | 0,25 | 335 | 481 | 1 | 1 |
| BOBO | 2,50 | 0,25 | 1.060 | 1.023 | 1 | 1 |
| Ali | 2,50 | 0,25 | 876 | 179 | 1 | 1 |
| Siti | 2,50 | 0,25 | 994 | 511 | 1 | 1 |
| Qonita | 2,50 | 0,25 | 1.514 | 914 | 1 | 1 |
| Muhammad Al-Fatih | 2,50 | 0,25 | 5.705 | 2.503 | 2 | 2 |

Tinggi garis potong jadi tetap 20 mm pada sebelum dan sesudah. Yang berubah adalah huruf di dalamnya: dulu hurufnya lebih kecil karena harus “menciut” 5 mm supaya hasil akhir tetap 20 mm. Sekarang huruf hanya menciut 0,5 mm, jadi bentuknya lebih dekat ke garis potong.

Celah antar huruf pada sampel ini, pada tinggi 20 mm, paling lebar sekitar 4,8 mm (huruf “Ali” dan “ll”). Ambang 6 mm menutup celah itu. Spasi kata sekitar 10,5 mm tetap terbuka. Nama panjang tidak menjadi satu balok melewati spasi.

Kotak dengan celah 4 mm: mesin lama menyambung tetapi pinggirnya gemuk 2,5 mm. Mesin baru tetap menyambung, dan pinggirnya hanya 0,25 mm di luar kotak. Celah 6,5 mm tidak disambung.

Lubang 1,9 mm: file DXF lama akan memotong segi 16. File DXF baru memakai entity `CIRCLE` berjari-jari 0,95 mm, juga setelah keping diputar 90 derajat. Lingkaran jari-jari 10 mm yang di-offset 0,25 mm menyimpang kurang dari 0,02 mm dari lingkaran sungguhan, dengan kurang dari 250 titik.

## Yang sengaja tidak diubah

- Lubang dalam huruf (tengah O, mata gambar) tetap tidak dipotong. Akrilik di situ tetap utuh.
- Template mode tetap tidak digemukkan. Garis potongnya tetap garis yang sudah digambar desainer.
- Gambar PNG tanpa vektor tetap menjadi kotak bersudut membulat. Layar template sekarang memberi peringatan, bukan diam-diam.

## Cara mengubah angkanya

Dua angka produksi ada di `lib/keychain-geometry.ts`:

- `OUTLINE_OFFSET_MM` — jarak garis potong dari tepi desain. Bawaan 0,25.
- `GAP_CLOSE_MM` — celah yang lebih sempit dari ini disambung. Bawaan 6. Radius sambungannya setengahnya (3 mm).

`CURVE_TOLERANCE_MM` (0,01) mengatur halusnya kurva. Menaikkannya membuat file lebih kecil dan garis lebih patah. Menurunkannya membuat file lebih besar.
