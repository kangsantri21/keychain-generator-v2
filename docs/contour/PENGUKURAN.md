# Pengukuran kontur — sebelum dan sesudah

Tanggal: 10 November 2026. Koreksi satuan dari Rofiq: offset yang diminta adalah Contour CorelDRAW ke luar, 1 langkah, **0,25 cm = 2,5 mm**. Bukan 0,25 mm.

Font sampel nama: DejaVu Sans. Tinggi teks jadi 20 mm (huruf mentah 15 mm, lalu offset 2,5 mm di tiap sisi). “Sebelum” adalah mesin lama: gemuk 4 mm lalu susut 1,5 mm, kurva diratakan pada 0,05 mm. “Sesudah” adalah offset 2,5 mm dengan sambungan bulat, lalu ceruk yang lebih sempit dari 4 mm diisi dengan closing bundar. Pinggiran luar tidak bergeser.

Gambar nama: [images/perbandingan.png](images/perbandingan.png). Merah = mesin lama. Biru = kontur baru.

Gambar “Faza”: [images/faza-aplikasi.png](images/faza-aplikasi.png). Font Noto Serif Display Bold Italic (Cooper/Bookman tidak ada di mesin ini). Huruf hitam, garis merah muda, tinggi huruf 22 mm supaya celah antar huruf masih di bawah 5 mm dan siluetnya satu keping, seperti sampel Corel. Perbesar sudut dan ceruk: [images/perbandingan-zoom.png](images/perbandingan-zoom.png).

## Angka

Offset adalah jarak median garis potong ke tepi huruf, dalam mm. Keping = jumlah garis potong tertutup.

| Nama | Offset lama | Offset baru | Titik lama | Titik baru | Keping |
| --- | --- | --- | --- | --- | --- |
| O | 2,50 | 2,50 | 335 | 233 | 1 → 1 |
| BOBO | 2,50 | 2,50 | 1.060 | 520 | 1 → 1 |
| Ali | 2,50 | 2,49 | 876 | 219 | 1 → 1 |
| Siti | 2,50 | 2,50 | 994 | 379 | 1 → 1 |
| Qonita | 2,50 | 2,50 | 1.514 | 592 | 1 → 1 |
| Muhammad Al-Fatih | 2,50 | 2,50 | 5.705 | 1.694 | 2 → 2 |
| Faza (22 mm) | 2,50 | 2,50 | 1.816 | 682 | 1 → 1 |

Dua keping pada nama panjang adalah spasi kata, yang lebih lebar dari 5 mm, jadi tidak disambung. Itu sama dengan mesin lama.

Kotak dengan celah 4 mm menjadi satu keping karena offset. Celah 6 mm tetap dua keping. Sudut kotak terukur sebagai busur jari-jari 2,5 mm. Teluk yang tersisa sekitar 3 mm sesudah offset diisi oleh ambang 4 mm. Teluk 14 mm tetap terbuka. Pinggiran luar kotak tidak bergeser saat ceruk ditutup. Lingkaran yang di-offset 2,5 mm menyimpang kurang dari 0,02 mm dari lingkaran sungguhan.

Lubang 1,9 mm: file lama sekitar 16 sisi. File baru entity `CIRCLE` jari-jari 0,95 mm.

Jumlah titik turun (nama panjang 5.705 menjadi 1.156) karena toleransi busur tidak lagi 0,00025 mm. 0,01 mm sudah halus saat sudut diperbesar, dan file tidak membesar.

## Cara mengubah

Di `lib/keychain-geometry.ts`:

- `OUTLINE_OFFSET_MM` — jarak kontur. Bawaan 2,5.
- `GAP_CLOSE_MM` — lebar ceruk yang diisi sesudah offset. Bawaan 4. Radiusnya 2 mm. Naikkan jika masih ada takik tipis. Turunkan jika lekukan huruf yang ingin dipertahankan ikut hilang. Spasi kata tidak tersambung selama kepingnya sudah terpisah.
- `SEAM_ROUND_MM` — fillet kecil (0,6 mm) hanya di sambungan washer atau karakter, bukan offset kedua.
- `CURVE_TOLERANCE_MM` — 0,01. Menaikkannya membuat garis lebih patah. Menurunkannya memperbanyak titik.
