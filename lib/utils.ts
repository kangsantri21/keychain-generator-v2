export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "template";
}

/**
 * Strips characters illegal in Windows/macOS filenames (`< > : " / \ | ? *`
 * and control characters), then trims stray whitespace and any trailing dot
 * (Windows rejects a filename ending in one) — so an operator's free-text
 * label (e.g. "Kode Lembar / Urgent") can double as a downloaded file's
 * name. Shared by both the print (JPG) and laser-cut (DXF) sheet exports so
 * their filenames always match exactly.
 */
export function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .trim()
    .replace(/[.\s]+$/, "");
}
