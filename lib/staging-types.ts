/** Client-safe mirror of the JSON shape returned by GET /api/staging. */

export interface GlyphSegmentPayload {
  d: string;
  color: string;
}

export interface CharacterImagePayload {
  dataUri: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KeychainRenderPayload {
  width: number;
  height: number;
  outlinePath: string | null;
  holePath: string | null;
  textSegments: GlyphSegmentPayload[];
  characterImage: CharacterImagePayload | null;
}

export interface StagingOrderPayload {
  id: number;
  receiptCode: string;
  manualCode: string;
}

export interface StagingTemplatePayload {
  id: number;
  code: string;
  isCharacter: boolean;
  thumbnailPath: string;
}

export interface StagingItemPayload {
  id: number;
  orderId: number;
  templateId: number;
  customerName: string;
  sheetId: number;
  posX: number;
  posY: number;
  width: number;
  height: number;
  rotated: boolean;
  /** 0, 90, 180 or 270. Missing on older rows: 90 when `rotated`, otherwise 0. */
  rotationDeg?: number | null;
  /** 1-based part of a receipt that did not fit one sheet. Null when the receipt is whole. */
  splitPart?: number | null;
  splitCount?: number | null;
  status: string;
  order: StagingOrderPayload | null;
  template: StagingTemplatePayload | null;
  render: KeychainRenderPayload | null;
}

/** Operator metrics + production validation status of one sheet (GET /api/staging, lib/production-gate.ts). */
export interface StagingSheetSummary {
  itemCount: number;
  receiptCount: number;
  usedWidth: number;
  usedHeight: number;
  remainingFullWidth: number;
  sideFragment: number;
  /** "production" = Production Nesting layout; "legacy" = Legacy Flat layout; "mixed" = both (invalid). */
  profile: "production" | "legacy" | "mixed";
  /** "explicit" = from the staging status marker; "geometry" = fallback inference (history only). */
  modeSource: "explicit" | "geometry";
  valid: boolean;
  errors: string[];
}

export interface StagingSheet {
  sheetId: number;
  items: StagingItemPayload[];
  /** Present on sheets served by GET /api/staging; absent on archived batch layouts. */
  summary?: StagingSheetSummary;
}
