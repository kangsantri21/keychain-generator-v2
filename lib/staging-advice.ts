/**
 * Sentences shown on an INVALID staging sheet. They name the cause and the
 * way back: dismantle, then nest again from the queue. Fresh nesting uses
 * the 2.5 mm contour and does not reuse the saved positions.
 */

export function duplicateReceiptMessage(count: number, otherSheetIds: number[]): string {
  const where = [...new Set(otherSheetIds)].sort((a, b) => a - b).map((id) => `#${id}`).join(", ");
  return `${count} resi di lembar ini juga ada di Lembar Kerja ${where}. Satu resi tidak boleh terpecah atau dicetak dua kali. Bongkar lembar yang dobel, lalu kirim ulang masing-masing resi satu kali dari Antrean.`;
}

export function contourSizeMessage(count: number): string {
  return `${count} keping berubah ukuran karena garis potong dihitung ulang dengan kontur 2,5 mm, bukan ukuran yang tersimpan saat lembar disusun. Posisi lama tidak dipakai. Bongkar lembar ini, lalu susun ulang dari Antrean.`;
}
