/** Client-safe mirror of the JSON shape returned by GET /api/staging. */

export interface GlyphSegmentPayload {
  d: string;
  color: string;
}

export interface CharacterImagePayload {
  dataUri: string;
  x: number;
  y: number;
  size: number;
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
  status: string;
  order: StagingOrderPayload | null;
  template: StagingTemplatePayload | null;
  render: KeychainRenderPayload | null;
}

export interface StagingSheet {
  sheetId: number;
  items: StagingItemPayload[];
}
