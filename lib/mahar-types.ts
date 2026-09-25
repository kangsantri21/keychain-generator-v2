/** Client-safe shared shapes for the "Bahan Mahar" module — no server-only imports, so both API routes and client pages/components can import this freely. */

export type MaharFrameShape = "rectangle" | "oval" | "circle" | "hexagon";
export type MaharStatus = "pending" | "processing" | "completed";

/** One order's own fields, independent of nesting/persistence — shared by the generator form, the nesting queue, and MaharLayoutItem below. */
export interface MaharOrderFields {
  brideName: string;
  groomName: string;
  weddingDate: string;
  nominal: string;
  frameShape: MaharFrameShape;
  size: string;
}

/**
 * One nested (or locked-batch) mahar piece — the order's own fields plus
 * the packer's computed on-sheet placement. `width`/`height` are the
 * ON-SHEET footprint (already swapped with the source size if `rotated`),
 * matching the keychain module's own stagingItems/PackedRect convention.
 */
export interface MaharLayoutItem extends MaharOrderFields {
  orderId: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotated: boolean;
}
