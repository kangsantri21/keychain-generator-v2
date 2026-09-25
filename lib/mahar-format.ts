const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/** Formats a "yyyy-mm-dd" (HTML date input) value as "12 Januari 2026" — falls back to the raw string for anything else, so a malformed/legacy value never crashes the preview. */
export function formatWeddingDate(weddingDate: string): string {
  const match = weddingDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return weddingDate;

  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return weddingDate;

  return `${Number(day)} ${MONTHS_ID[monthIndex]} ${year}`;
}
