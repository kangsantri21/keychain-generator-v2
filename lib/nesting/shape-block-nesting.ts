/**
 * Shape-block nesting (P0.4–P0.6).
 *
 * One receipt is one framed block when it fits on a 310×470 sheet. Inside
 * the block, pieces are placed by their cut outline (a rectangle when no
 * outline was given) and may turn 0/90/180/270. 180° is a different outline
 * even though the box does not change, so a notch can receive the neighbouring
 * piece. The whole block may then turn 90° if that makes the sheet shorter.
 * A thin frame and one receipt code sit in a gutter reserved beside the
 * frame — the code is not dropped into a hole.
 *
 * A receipt that still does not fit after those rotations is split into as
 * few framed parts as possible. Each part is its own block on its own sheet,
 * labeled "<kode> 1/N". A receipt that fits is never split. The box packer
 * in grouped-nesting.ts is not this path: it still reports
 * ORDER_GROUP_TOO_LARGE_FOR_SHEET and does not draw frames.
 *
 * Bounding boxes of pieces in the same receipt may overlap. The cut lines
 * stay at least `cutClearanceMm` apart. Pieces from two receipts never share
 * a block.
 */
import { receiptPartLabel } from "@/lib/receipt-parts";
import { fiducialDistance } from "@/lib/production-gate";
import { FIDUCIAL_CLEARANCE_MM } from "@/lib/nesting/grouped-nesting-config";
import {
  labelSide,
  resolveShapeConfig,
  type ShapeBlockConfig,
} from "@/lib/nesting/shape-block-config";
import {
  addTurns,
  outlinesTooClose,
  prepareOutline,
  preparedTooClose,
  rectOutline,
  rotateOutline,
  roundMm,
  translatePolys,
  type PreparedOutline,
  type Pt,
  type QuarterTurn,
} from "@/lib/nesting/shape-outline";

const EPS = 1e-6;

export interface ShapeBlockItem<T> {
  id: string | number;
  orderId: number | null;
  width: number;
  height: number;
  allowRotation: boolean;
  /** Cut outline in unrotated artwork millimetres. Missing = the bounding rectangle. */
  outline?: Pt[][];
  receiptCode?: string;
  data: T;
}

export interface ShapeBlockPlacement<T> {
  item: ShapeBlockItem<T>;
  orderId: number | null;
  sheetIndex: number;
  posX: number;
  posY: number;
  /** On-sheet footprint. Swapped when the artwork sits at 90° or 270°. */
  width: number;
  height: number;
  rotated: boolean;
  rotationDeg: QuarterTurn;
  /** Cut outline in sheet millimetres. */
  outline: Pt[][];
  /** 1-based part of an oversized receipt. Null when the receipt stayed whole. */
  splitPart: number | null;
  splitCount: number | null;
}

export interface ShapeBlockInfo {
  orderId: number | null;
  sheetIndex: number;
  /** 0, or 90 when the whole block was turned. */
  blockRotation: 0 | 90;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Printed code, including " 1/2" when this block is one part of a split. */
  label: string;
  splitPart: number | null;
  splitCount: number | null;
}

export interface ShapeBlockResult<T> {
  ok: boolean;
  errors: string[];
  placements: ShapeBlockPlacement<T>[];
  blocks: ShapeBlockInfo[];
  sheetCount: number;
  /** Sum of per-sheet bottoms of the receipt footprints (frame + label gutter included). */
  sumUsedHeight: number;
  config: ShapeBlockConfig;
}

interface LocalPiece<T> {
  item: ShapeBlockItem<T>;
  x: number;
  y: number;
  rot: QuarterTurn;
  w: number;
  h: number;
  polys: Pt[][];
  /** Outline offset by the cut clearance, in the piece's local coordinates. */
  prepared: PreparedOutline;
}

interface FootprintOption<T> {
  blockRot: 0 | 90;
  side: "left" | "bottom";
  footW: number;
  footH: number;
  contentW: number;
  contentH: number;
  pieces: LocalPiece<T>[];
}

interface BuiltBlock<T> {
  orderId: number | null;
  code: string;
  label: string;
  splitPart: number | null;
  splitCount: number | null;
  /** Split parts of one receipt each take their own sheet. */
  soloSheet: boolean;
  options: FootprintOption<T>[];
  maxArea: number;
}

type LayoutMode = "full" | "shelf" | "search";

interface PlacedFootprint {
  orderId: number | null;
  sheet: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function outlineOf<T>(item: ShapeBlockItem<T>): Pt[][] {
  return item.outline && item.outline.length > 0 ? item.outline : rectOutline(item.width, item.height);
}

function pieceAt<T>(item: ShapeBlockItem<T>, rot: QuarterTurn, x: number, y: number, clearance: number): LocalPiece<T> {
  const turned = rotateOutline(outlineOf(item), item.width, item.height, rot);
  return {
    item,
    x,
    y,
    rot,
    w: turned.width,
    h: turned.height,
    polys: turned.polys,
    prepared: prepareOutline(turned.polys, clearance),
  };
}

type PlaceRank = [number, number, number, number, number];

/**
 * 1 when this turn faces the same way as a piece it touches. Material
 * (bottom, then right) is compared first, so a flip is chosen only when it
 * does not make the block taller or wider.
 */
function facingPenalty(
  placed: { x: number; y: number; w: number; h: number; rot: QuarterTurn }[],
  x: number,
  y: number,
  w: number,
  h: number,
  rot: QuarterTurn,
  clearance: number
): number {
  for (const other of placed) {
    const vertical = Math.min(y + h, other.y + other.h) - Math.max(y, other.y);
    const horizontal = Math.min(x + w, other.x + other.w) - Math.max(x, other.x);
    const beside =
      vertical > 1 &&
      (Math.abs(x - (other.x + other.w + clearance)) < 1.5 || Math.abs(other.x - (x + w + clearance)) < 1.5);
    const stacked =
      horizontal > 1 &&
      (Math.abs(y - (other.y + other.h + clearance)) < 1.5 || Math.abs(other.y - (y + h + clearance)) < 1.5);
    if ((beside || stacked) && other.rot === rot) return 1;
  }
  return 0;
}

function placeRank(
  bottom: number,
  right: number,
  y: number,
  x: number,
  rot: QuarterTurn,
  w: number,
  h: number,
  placed: { x: number; y: number; w: number; h: number; rot: QuarterTurn }[],
  clearance: number
): PlaceRank {
  return [bottom, right, facingPenalty(placed, x, y, w, h, rot, clearance), y, x];
}

function keyBefore(a: PlaceRank, b: PlaceRank): boolean {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPS) return a[i] < b[i];
  return false;
}

function rectsApart(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, gap: number): boolean {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return dx >= gap - EPS || dy >= gap - EPS;
}

function hitsPiece(piece: LocalPiece<unknown>, x: number, y: number, others: LocalPiece<unknown>[], clearance: number): boolean {
  const box = { x, y, w: piece.w, h: piece.h };
  for (const other of others) {
    if (other === piece) continue;
    const otherBox = { x: other.x, y: other.y, w: other.w, h: other.h };
    // Outlines live inside their boxes, so a wide box gap is already safe.
    if (rectsApart(box, otherBox, clearance)) continue;
    if (preparedTooClose(piece.prepared, x, y, other.prepared, other.x, other.y)) return true;
  }
  return false;
}

function slidePieces<T>(pieces: LocalPiece<T>[], clearance: number): LocalPiece<T>[] {
  const placed = pieces.map((p) => ({ ...p }));
  for (let pass = 0; pass < 5; pass++) {
    let moved = false;
    const order = [...placed].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const piece of order) {
      const others = placed.filter((p) => p !== piece);
      const nextY = slideCoord(piece.y, (y) => hitsPiece(piece, piece.x, y, others, clearance));
      const nextX = slideCoord(piece.x, (x) => hitsPiece(piece, x, nextY, others, clearance));
      if (Math.abs(nextX - piece.x) > 0.02 || Math.abs(nextY - piece.y) > 0.02) {
        piece.x = nextX;
        piece.y = nextY;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return normalize(placed);
}

/** Smallest coordinate >= 0 that does not collide. `hits(current)` is false. */
function slideCoord(current: number, hits: (value: number) => boolean): number {
  if (current <= 0.02) return 0;
  if (!hits(0)) return 0;
  let lo = 0;
  let hi = current;
  // 0.2 mm is finer than the gap tolerance used when blocks are placed.
  for (let i = 0; i < 12 && hi - lo > 0.2; i++) {
    const mid = (lo + hi) / 2;
    if (hits(mid)) lo = mid;
    else hi = mid;
  }
  return hi;
}

function normalize<T>(pieces: LocalPiece<T>[]): LocalPiece<T>[] {
  if (pieces.length === 0) return pieces;
  const minX = Math.min(...pieces.map((p) => p.x));
  const minY = Math.min(...pieces.map((p) => p.y));
  return pieces.map((p) => ({ ...p, x: p.x - minX, y: p.y - minY }));
}

function sizeOf(pieces: LocalPiece<unknown>[]): { w: number; h: number; area: number } {
  if (pieces.length === 0) return { w: 0, h: 0, area: 0 };
  const w = Math.max(...pieces.map((p) => p.x + p.w));
  const h = Math.max(...pieces.map((p) => p.y + p.h));
  return { w, h, area: w * h };
}

/**
 * How short this block can sit on the sheet. A wide row that fits across
 * the width beats a tall column of the same pieces: the sheet is trimmed to
 * the used height, so height is the material. Area is only the last tie-break.
 * Nothing here forces a long name to stand up.
 */
function materialRank(w: number, h: number, maxW: number, maxH: number): [number, number, number] | null {
  const fits: [number, number][] = [];
  if (w <= maxW + 0.2 && h <= maxH + 0.2) fits.push([h, w]);
  if (h <= maxW + 0.2 && w <= maxH + 0.2) fits.push([w, h]);
  if (fits.length === 0) return null;
  fits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return [fits[0][0], fits[0][1], w * h];
}

function betterLayout(a: LocalPiece<unknown>[], b: LocalPiece<unknown>[], maxW: number, maxH: number): boolean {
  const sa = sizeOf(a);
  const sb = sizeOf(b);
  const ra = materialRank(sa.w, sa.h, maxW, maxH);
  const rb = materialRank(sb.w, sb.h, maxW, maxH);
  if (ra && !rb) return true;
  if (!ra || !rb) return false;
  for (let i = 0; i < ra.length; i++) if (Math.abs(ra[i] - rb[i]) > 0.5) return ra[i] < rb[i];
  return false;
}

function turnsFor<T>(item: ShapeBlockItem<T>, base: QuarterTurn): QuarterTurn[] {
  if (!item.allowRotation) return [0];
  return [base, addTurns(base, 180)];
}

function stackLayout<T>(
  items: ShapeBlockItem<T>[],
  baseOf: (item: ShapeBlockItem<T>, index: number) => QuarterTurn,
  maxH: number,
  maxW: number,
  gap: number
): LocalPiece<T>[] | null {
  const columns: LocalPiece<T>[][] = [];
  let column: LocalPiece<T>[] = [];
  let colH = 0;
  let colW = 0;
  const flush = () => {
    if (column.length === 0) return;
    const x = columns.reduce((sum, col) => sum + Math.max(...col.map((p) => p.w)) + gap, 0);
    for (const piece of column) piece.x = x;
    columns.push(column);
    column = [];
    colH = 0;
    colW = 0;
  };
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rot = turnsFor(item, baseOf(item, i))[0];
    const piece = pieceAt(item, rot, 0, 0, gap);
    if (piece.h > maxH + EPS || piece.w > maxW + EPS) {
      const other = item.allowRotation ? pieceAt(item, addTurns(rot, 90), 0, 0, gap) : null;
      if (!other || other.h > maxH + EPS || other.w > maxW + EPS) return null;
      piece.rot = other.rot;
      piece.w = other.w;
      piece.h = other.h;
      piece.polys = other.polys;
      piece.prepared = other.prepared;
    }
    if (column.length > 0 && colH + piece.h > maxH + EPS) flush();
    piece.y = colH;
    column.push(piece);
    colH += piece.h + gap;
    colW = Math.max(colW, piece.w);
    const usedW = columns.reduce((sum, col) => sum + Math.max(...col.map((p) => p.w)) + gap, 0) + colW;
    if (usedW > maxW + EPS) return null;
  }
  flush();
  return columns.flat();
}

interface RasterMask {
  data: Uint8Array;
  gw: number;
  gh: number;
  /** Mask pixel (0, 0) corresponds to this offset from the piece origin. */
  origin: number;
}

function fillPolygon(data: Uint8Array, gw: number, gh: number, poly: Pt[], ox: number, oy: number): void {
  if (poly.length < 3) return;
  const n = poly.length;
  let minY = gh;
  let maxY = 0;
  for (const p of poly) {
    const y = p.y - oy;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(gh - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const ymid = y + 0.5;
    const nodes: number[] = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yA = poly[j].y - oy;
      const yB = poly[i].y - oy;
      if ((yA <= ymid && yB > ymid) || (yB <= ymid && yA > ymid)) {
        const t = (ymid - yA) / (yB - yA);
        nodes.push(poly[j].x - ox + t * (poly[i].x - poly[j].x));
      }
    }
    nodes.sort((a, b) => a - b);
    for (let k = 0; k + 1 < nodes.length; k += 2) {
      const xStart = Math.max(0, Math.floor(nodes[k]));
      const xEnd = Math.min(gw - 1, Math.ceil(nodes[k + 1]) - 1);
      const row = y * gw;
      for (let x = xStart; x <= xEnd; x++) data[row + x] = 1;
    }
  }
}

/** 1 mm cells. The mask is the outline dilated by the clearance so a later overlap test is the gap. */
function rasterMask(polys: Pt[][], width: number, height: number, clearance: number): RasterMask {
  const origin = Math.ceil(clearance);
  const gw = Math.max(1, Math.ceil(width) + origin * 2);
  const gh = Math.max(1, Math.ceil(height) + origin * 2);
  const filled = new Uint8Array(gw * gh);
  for (const poly of polys) fillPolygon(filled, gw, gh, poly, -origin, -origin);
  if (origin <= 0) return { data: filled, gw, gh, origin };
  const data = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!filled[y * gw + x]) continue;
      for (let dy = -origin; dy <= origin; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= gh) continue;
        const row = ny * gw;
        for (let dx = -origin; dx <= origin; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= gw) continue;
          data[row + nx] = 1;
        }
      }
    }
  }
  return { data, gw, gh, origin };
}

function maskHits(sheet: Uint8Array, sw: number, sh: number, mask: RasterMask, x: number, y: number): boolean {
  const x0 = x - mask.origin;
  const y0 = y - mask.origin;
  for (let py = 0; py < mask.gh; py++) {
    const sy = y0 + py;
    const row = py * mask.gw;
    for (let px = 0; px < mask.gw; px++) {
      if (!mask.data[row + px]) continue;
      const sx = x0 + px;
      if (sy < 0 || sx < 0) continue;
      if (sx >= sw || sy >= sh || sheet[sy * sw + sx]) return true;
    }
  }
  return false;
}

function stampOutline(sheet: Uint8Array, sw: number, sh: number, polys: Pt[][], x: number, y: number): void {
  // Stamp the real outline. The dilated mask is only used while testing a gap.
  for (const poly of polys) fillPolygon(sheet, sw, sh, poly, -x, -y);
}

/**
 * Bottom-left nest on a 1 mm picture of the cut line. This is the search used
 * for a whole sheet of pieces: the same anchor idea as the clipper search,
 * without offsetting every candidate. A later slide pass checks the true gap.
 */
function rasterNest<T>(items: ShapeBlockItem<T>[], maxW: number, maxH: number, clearance: number): LocalPiece<T>[] | null {
  const sw = Math.max(1, Math.floor(maxW + EPS));
  const sh = Math.max(1, Math.floor(maxH + EPS));
  const sheet = new Uint8Array(sw * sh);
  const sorted = [...items].sort(
    (a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || String(a.id).localeCompare(String(b.id))
  );
  const placed: LocalPiece<T>[] = [];
  const masks = new Map<string, RasterMask>();
  const maskFor = (piece: LocalPiece<T>) => {
    const key = `${piece.item.id}:${piece.rot}`;
    const cached = masks.get(key);
    if (cached) return cached;
    const built = rasterMask(piece.polys, piece.w, piece.h, clearance);
    masks.set(key, built);
    return built;
  };
  for (const item of sorted) {
    const rots: QuarterTurn[] = item.allowRotation ? [0, 180, 90, 270] : [0];
    let best: LocalPiece<T> | null = null;
    let bestKey: PlaceRank | null = null;
    for (const rot of rots) {
      const proto = pieceAt(item, rot, 0, 0, clearance);
      if (proto.w > maxW + EPS || proto.h > maxH + EPS) continue;
      const mask = maskFor(proto);
      const xs = new Set<number>([0]);
      const ys = new Set<number>([0]);
      for (const p of placed) {
        xs.add(Math.max(0, Math.round(p.x)));
        ys.add(Math.max(0, Math.round(p.y)));
        xs.add(Math.max(0, Math.round(p.x + p.w + clearance)));
        ys.add(Math.max(0, Math.round(p.y + p.h + clearance)));
        for (const inset of [4, 8]) {
          xs.add(Math.max(0, Math.round(p.x + p.w + clearance - inset)));
          ys.add(Math.max(0, Math.round(p.y + p.h + clearance - inset)));
        }
      }
      const yList = [...ys].filter((y) => y + proto.h <= maxH + 0.2).sort((a, b) => a - b);
      const xList = [...xs].filter((x) => x + proto.w <= maxW + 0.2).sort((a, b) => a - b);
      for (const y of yList) {
        let foundOnRow = false;
        for (const x of xList) {
          if (maskHits(sheet, sw, sh, mask, x, y)) continue;
          const bottom = Math.max(y + proto.h, ...placed.map((p) => p.y + p.h), 0);
          const right = Math.max(x + proto.w, ...placed.map((p) => p.x + p.w), 0);
          const key = placeRank(bottom, right, y, x, rot, proto.w, proto.h, placed, clearance);
          if (!bestKey || keyBefore(key, bestKey)) {
            bestKey = key;
            best = { ...proto, x, y };
          }
          foundOnRow = true;
          break;
        }
        if (foundOnRow && best && Math.abs(best.y - y) < 0.5) break;
      }
    }
    if (!best) return null;
    placed.push(best);
    stampOutline(sheet, sw, sh, best.polys, best.x, best.y);
  }
  return placed;
}

/**
 * Bottom-left nest on the cut outline. Anchors step a few millimetres into
 * the neighbour's box so a notch can take the next piece. 180° is tried,
 * not only 90°, because a flip is what lets two wavy names share a gap.
 */
function outlineNest<T>(items: ShapeBlockItem<T>[], maxW: number, maxH: number, clearance: number): LocalPiece<T>[] | null {
  const sorted = [...items].sort((a, b) => Math.max(b.width, b.height) - Math.max(a.width, a.height) || String(a.id).localeCompare(String(b.id)));
  const placed: LocalPiece<T>[] = [];
  for (const item of sorted) {
    const rots: QuarterTurn[] = item.allowRotation ? [0, 180, 90, 270] : [0];
    let best: LocalPiece<T> | null = null;
    let bestKey: PlaceRank | null = null;
    for (const rot of rots) {
      const proto = pieceAt(item, rot, 0, 0, clearance);
      if (proto.w > maxW + EPS || proto.h > maxH + EPS) continue;
      const xs = new Set<number>([0]);
      const ys = new Set<number>([0]);
      for (const p of placed) {
        xs.add(roundMm(Math.max(0, p.x)));
        ys.add(roundMm(Math.max(0, p.y)));
        xs.add(roundMm(p.x + p.w + clearance));
        ys.add(roundMm(p.y + p.h + clearance));
        for (const inset of [3, 6, 10]) {
          xs.add(roundMm(Math.max(0, p.x + p.w + clearance - inset)));
          ys.add(roundMm(Math.max(0, p.y + p.h + clearance - inset)));
        }
      }
      const yList = [...ys].filter((y) => y + proto.h <= maxH + 0.2).sort((a, b) => a - b);
      const xList = [...xs].filter((x) => x + proto.w <= maxW + 0.2).sort((a, b) => a - b);
      for (const y of yList) {
        let foundOnRow = false;
        for (const x of xList) {
          if (hitsPiece(proto, x, y, placed, clearance)) continue;
          const bottoms = placed.map((p) => p.y + p.h);
          const rights = placed.map((p) => p.x + p.w);
          const bottom = Math.max(y + proto.h, ...bottoms, 0);
          const right = Math.max(x + proto.w, ...rights, 0);
          const key = placeRank(bottom, right, y, x, rot, proto.w, proto.h, placed, clearance);
          if (!bestKey || keyBefore(key, bestKey)) {
            bestKey = key;
            best = { ...proto, x, y };
          }
          foundOnRow = true;
          break;
        }
        if (foundOnRow && best && best.y === y) break;
      }
    }
    if (!best) return null;
    placed.push(best);
  }
  return placed;
}

function baseRot<T>(item: ShapeBlockItem<T>): QuarterTurn {
  return item.allowRotation && item.width > item.height + 0.5 ? 90 : 0;
}

function oddTurn(index: number): QuarterTurn {
  return index % 2 === 1 ? 180 : 0;
}

function finish<T>(pieces: LocalPiece<T>[] | null, clearance: number, maxW: number, maxH: number): LocalPiece<T>[] | null {
  if (!pieces || pieces.length === 0) return null;
  let slid = slidePieces(pieces, clearance);
  slid = flipPass(slid, clearance);
  slid = tuckBottoms(slid, maxW, maxH, clearance);
  slid = fillVoids(slid, maxW, maxH, clearance);
  return slid;
}

function pairTooClose<T>(a: LocalPiece<T>, b: LocalPiece<T>, clearance: number): boolean {
  return outlinesTooClose(translatePolys(a.polys, a.x, a.y), translatePolys(b.polys, b.x, b.y), clearance);
}

function pushToClearance<T>(pieces: LocalPiece<T>[], clearance: number, maxW: number, maxH: number): LocalPiece<T>[] | null {
  const placed = pieces.map((piece) => ({ ...piece }));
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (rectsApart({ x: a.x, y: a.y, w: a.w, h: a.h }, { x: b.x, y: b.y, w: b.w, h: b.h }, clearance)) continue;
        if (!pairTooClose(a, b, clearance)) continue;
        const target = a.x + a.y <= b.x + b.y ? b : a;
        const other = target === a ? b : a;
        const gapX = target.x - (other.x + other.w);
        const gapY = target.y - (other.y + other.h);
        if (gapX < gapY) target.x += 0.2;
        else target.y += 0.2;
        moved = true;
      }
    }
    if (!moved) {
      const size = sizeOf(placed);
      if (size.w > maxW + 0.2 || size.h > maxH + 0.2) return null;
      return normalize(placed);
    }
  }
  const size = sizeOf(placed);
  if (size.w > maxW + 0.2 || size.h > maxH + 0.2) return null;
  return pairClear(placed, clearance) ? normalize(placed) : null;
}

function pairClear<T>(pieces: LocalPiece<T>[], clearance: number): boolean {
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (rectsApart(
        { x: pieces[i].x, y: pieces[i].y, w: pieces[i].w, h: pieces[i].h },
        { x: pieces[j].x, y: pieces[j].y, w: pieces[j].w, h: pieces[j].h },
        clearance
      )) continue;
      if (pairTooClose(pieces[i], pieces[j], clearance)) return false;
    }
  }
  return true;
}

/** Empty 1 mm cells inside the block's own box. Lower means the gaps are filled. */
function voidCells<T>(pieces: LocalPiece<T>[]): number {
  const size = sizeOf(pieces);
  const gw = Math.max(1, Math.ceil(size.w));
  const gh = Math.max(1, Math.ceil(size.h));
  const grid = new Uint8Array(gw * gh);
  for (const piece of pieces) {
    const x0 = Math.max(0, Math.floor(piece.x));
    const y0 = Math.max(0, Math.floor(piece.y));
    const x1 = Math.min(gw, Math.ceil(piece.x + piece.w));
    const y1 = Math.min(gh, Math.ceil(piece.y + piece.h));
    for (let y = y0; y < y1; y++) {
      const row = y * gw;
      for (let x = x0; x < x1; x++) grid[row + x] = 1;
    }
  }
  let empty = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === 0) empty++;
  return empty;
}

/**
 * Slide a small piece into a hole inside the block. Kept only when the block
 * does not grow and the hole gets smaller. Cut clearance still applies.
 */
function fillVoids<T>(pieces: LocalPiece<T>[], maxW: number, maxH: number, clearance: number): LocalPiece<T>[] {
  if (pieces.length > 24) return pieces;
  let best = pieces;
  let bestVoid = voidCells(best);
  const movable = [...best].sort((a, b) => a.w * a.h - b.w * b.h).slice(0, 8);
  for (const piece of movable) {
    const others = best.filter((other) => other !== piece);
    const rots: QuarterTurn[] = piece.item.allowRotation ? [0, 180, 90, 270] : [piece.rot];
    for (const rot of rots) {
      const proto = pieceAt(piece.item, rot, 0, 0, clearance);
      const anchors: { x: number; y: number }[] = [];
      for (const other of others) {
        anchors.push({ x: roundMm(other.x + other.w + clearance), y: other.y });
        anchors.push({ x: other.x, y: roundMm(other.y + other.h + clearance) });
        anchors.push({ x: roundMm(Math.max(0, other.x + other.w - proto.w)), y: other.y });
      }
      for (const anchor of anchors) {
        if (anchor.x < -EPS || anchor.y < -EPS) continue;
        if (anchor.x + proto.w > maxW + 0.2 || anchor.y + proto.h > maxH + 0.2) continue;
        if (hitsPiece(proto, anchor.x, anchor.y, others, clearance)) continue;
        const trial = normalize([...others, { ...proto, x: anchor.x, y: anchor.y }]);
        const size = sizeOf(trial);
        const had = sizeOf(best);
        if (size.h > had.h + 0.5 || size.w > had.w + 0.5) continue;
        const voids = voidCells(trial);
        if (voids + 8 < bestVoid || betterLayout(trial, best, maxW, maxH)) {
          best = trial;
          bestVoid = voids;
        }
      }
    }
  }
  return best;
}

/**
 * A piece that sticks out at the bottom is tried in the gaps beside its
 * neighbours, including turned 90° or 270°. The move is kept only when the
 * block gets shorter, or just as short and narrower.
 */
function tuckBottoms<T>(pieces: LocalPiece<T>[], maxW: number, maxH: number, clearance: number): LocalPiece<T>[] {
  if (pieces.length > 24) return pieces;
  let best = pieces;
  const bottom = Math.max(...pieces.map((piece) => piece.y + piece.h));
  const sticking = pieces.filter((piece) => bottom - (piece.y + piece.h) < 1).slice(0, 4);
  for (const piece of sticking) {
    const others = best.filter((other) => other !== piece);
    const rots: QuarterTurn[] = piece.item.allowRotation ? [0, 90, 180, 270] : [piece.rot];
    for (const rot of rots) {
      const proto = pieceAt(piece.item, rot, 0, 0, clearance);
      const anchors: { x: number; y: number }[] = [{ x: 0, y: 0 }];
      for (const other of others) {
        anchors.push({ x: roundMm(other.x + other.w + clearance), y: other.y });
        anchors.push({ x: other.x, y: roundMm(other.y + other.h + clearance) });
      }
      for (const anchor of anchors) {
        if (anchor.x < -EPS || anchor.y < -EPS) continue;
        if (anchor.x + proto.w > maxW + 0.2 || anchor.y + proto.h > maxH + 0.2) continue;
        if (hitsPiece(proto, anchor.x, anchor.y, others, clearance)) continue;
        const trial = normalize([...others, { ...proto, x: anchor.x, y: anchor.y }]);
        if (betterLayout(trial, best, maxW, maxH)) best = trial;
      }
    }
  }
  return best;
}

function flipPass<T>(pieces: LocalPiece<T>[], clearance: number): LocalPiece<T>[] {
  let best = pieces;
  const trials: LocalPiece<T>[][] = [];
  if (pieces.length <= 10) {
    for (let i = 0; i < pieces.length; i++) {
      if (!pieces[i].item.allowRotation) continue;
      trials.push(pieces.map((p, index) => (index === i ? flipped(p, clearance) : p)));
    }
  }
  trials.push(pieces.map((p, index) => (index % 2 === 1 && p.item.allowRotation ? flipped(p, clearance) : p)));
  for (const trial of trials) {
    const slid = slidePieces(trial, clearance);
    if (sizeOf(slid).area + 0.5 < sizeOf(best).area) best = slid;
  }
  return best;
}

function flipped<T>(piece: LocalPiece<T>, clearance: number): LocalPiece<T> {
  const rot = addTurns(piece.rot, 180);
  return pieceAt(piece.item, rot, piece.x, piece.y, clearance);
}

/**
 * Names stood on end (90°, or 270° on every other piece) and set side by
 * side, like the columns on the manual sheet. The next column starts when
 * the row of strips is full. 270° is a 90° turn plus a flip, so neighbouring
 * waves can sit in each other's gaps.
 */
function columnStrips<T>(
  items: ShapeBlockItem<T>[],
  maxW: number,
  maxH: number,
  gap: number,
  flip: boolean
): LocalPiece<T>[] | null {
  const placed: LocalPiece<T>[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rot: QuarterTurn = !item.allowRotation ? 0 : flip && i % 2 === 1 ? 270 : 90;
    let piece = pieceAt(item, rot, 0, 0, gap);
    if (piece.h > maxH + EPS) return null;
    if (piece.w > maxW + EPS) {
      if (!item.allowRotation) return null;
      piece = pieceAt(item, 0, 0, 0, gap);
      if (piece.w > maxW + EPS || piece.h > maxH + EPS) return null;
    }
    if (x > 0 && x + piece.w > maxW + EPS) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
      if (y + piece.h > maxH + EPS) return null;
    }
    piece.x = x;
    piece.y = y;
    placed.push(piece);
    x += piece.w + gap;
    rowH = Math.max(rowH, piece.h);
  }
  return placed;
}

/** Fill a row left to right, then the next row. Rotation is whatever `rotOf` picks. */
function rowShelf<T>(
  items: ShapeBlockItem<T>[],
  rotOf: (item: ShapeBlockItem<T>, index: number) => QuarterTurn,
  maxW: number,
  gap: number
): LocalPiece<T>[] | null {
  const placed: LocalPiece<T>[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rot = item.allowRotation ? rotOf(item, i) : 0;
    let piece = pieceAt(item, rot, 0, 0, gap);
    if (piece.w > maxW + EPS) {
      if (!item.allowRotation) return null;
      const turned = pieceAt(item, addTurns(rot, 90), 0, 0, gap);
      if (turned.w > maxW + EPS) return null;
      piece = turned;
    }
    if (x > 0 && x + piece.w > maxW + EPS) {
      y += rowH + gap;
      x = 0;
      rowH = 0;
    }
    piece.x = x;
    piece.y = y;
    placed.push(piece);
    x += piece.w + gap;
    rowH = Math.max(rowH, piece.h);
  }
  return placed;
}

/**
 * Several honest shapes for one receipt. The shortest one is not always the
 * best once other receipts share the sheet, so the outer search keeps a
 * few that are not strictly larger in both directions.
 */
function layoutCandidates<T>(
  items: ShapeBlockItem<T>[],
  maxW: number,
  maxH: number,
  clearance: number,
  mode: LayoutMode = "full"
): LocalPiece<T>[][] {
  const gap = clearance;
  const heights = [maxH, maxH * 0.62, maxH * 0.4];
  // Bottom-left search is worthwhile for a small receipt. On a full manual
  // sheet (dozens of pieces) it spends a long time and then rejects the
  // layout; row and column packing plus the slide pass already interlock.
  // "shelf" and "search" skip that search. "search" also skips the slide,
  // so a binary search over a prefix stays cheap. A raw shelf is never
  // smaller than the slid one, so a prefix that fails here cannot fit.
  const raw: (LocalPiece<T>[] | null)[] = [
    columnStrips(items, maxW, maxH, gap, true),
    columnStrips(items, maxW, maxH, gap, false),
    columnStrips(items, maxW * 0.55, maxH, gap, true),
    rowShelf(items, (_item, index) => oddTurn(index), maxW, gap),
    rowShelf(items, () => 0, maxW, gap),
    rowShelf(items, (item) => baseRot(item), maxW, gap),
  ];
  if (mode === "full") {
    raw.push(rasterNest(items, maxW, maxH, gap));
    raw.push(items.length <= 18 ? outlineNest(items, maxW, maxH, gap) : null);
  }
  for (const limit of heights) {
    raw.push(stackLayout(items, () => 0, limit, maxW, gap));
    raw.push(stackLayout(items, (item) => baseRot(item), limit, maxW, gap));
  }
  const finished: LocalPiece<T>[][] = [];
  for (const candidate of raw) {
    if (!candidate) continue;
    const done = mode === "search" ? candidate : finish(candidate, clearance, maxW, maxH);
    if (!done) continue;
    const size = sizeOf(done);
    if (!materialRank(size.w, size.h, maxW, maxH)) continue;
    finished.push(done);
  }
  const pareto = finished.filter((layout, index) => {
    const a = sizeOf(layout);
    return !finished.some((other, j) => {
      if (j === index) return false;
      const b = sizeOf(other);
      return b.w <= a.w + 1 && b.h <= a.h + 1 && (b.w < a.w - 1 || b.h < a.h - 1);
    });
  });
  const byShort = [...pareto].sort((a, b) => {
    const ra = materialRank(sizeOf(a).w, sizeOf(a).h, maxW, maxH)!;
    const rb = materialRank(sizeOf(b).w, sizeOf(b).h, maxW, maxH)!;
    return ra[0] - rb[0] || ra[1] - rb[1];
  });
  const byNarrow = [...pareto].sort((a, b) => sizeOf(a).w - sizeOf(b).w || sizeOf(a).h - sizeOf(b).h);
  const picked: LocalPiece<T>[][] = [];
  for (const layout of [...byShort, ...byNarrow]) {
    const size = sizeOf(layout);
    if (picked.some((have) => Math.abs(sizeOf(have).w - size.w) < 8 && Math.abs(sizeOf(have).h - size.h) < 8)) continue;
    picked.push(layout);
    if (picked.length >= 6) break;
  }
  // The coarse search can leave a cut gap under 1 mm. Correct only the few
  // layouts we might actually use — doing it on every candidate is what made
  // a full pending batch take about a minute. The prefix search that decides
  // how to split a huge receipt skips this; the sheet is repaired later.
  if (mode === "search") return picked;
  const cleared: LocalPiece<T>[][] = [];
  for (const layout of picked) {
    const pushed = pushToClearance(layout, clearance, maxW, maxH);
    if (pushed) cleared.push(pushed);
  }
  return cleared;
}

function optionFrom<T>(pieces: LocalPiece<T>[], blockRot: 0 | 90, config: ShapeBlockConfig): FootprintOption<T> {
  const content = sizeOf(pieces);
  const contentW = blockRot === 0 ? content.w : content.h;
  const contentH = blockRot === 0 ? content.h : content.w;
  const frameW = contentW + 2 * config.framePadMm;
  const frameH = contentH + 2 * config.framePadMm;
  const side = labelSide(frameW, frameH);
  const footW = side === "left" ? frameW + config.labelGutterMm : frameW;
  const footH = side === "bottom" ? frameH + config.labelGutterMm : frameH;
  return { blockRot, side, footW, footH, contentW: content.w, contentH: content.h, pieces };
}

function mapContentRect(
  rect: { x: number; y: number; w: number; h: number },
  blockRot: 0 | 90,
  contentW: number,
  contentH: number
): { x: number; y: number; w: number; h: number } {
  if (blockRot === 0) return rect;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x + rect.w, y: rect.y + rect.h },
  ].map((p) => ({ x: contentH - p.y, y: p.x }));
  const minX = Math.min(...corners.map((p) => p.x));
  const minY = Math.min(...corners.map((p) => p.y));
  const maxX = Math.max(...corners.map((p) => p.x));
  const maxY = Math.max(...corners.map((p) => p.y));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function separation(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  return Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
}

function fitsSheet(x: number, y: number, w: number, h: number, config: ShapeBlockConfig): boolean {
  const m = config.sheetMarginMm;
  if (x < m - EPS || y < m - EPS) return false;
  if (x + w > config.sheetWidthMm - m + EPS) return false;
  if (y + h > config.sheetHeightMm - m + EPS) return false;
  const dist = fiducialDistance({ posX: x, posY: y, width: w, height: h });
  return dist >= FIDUCIAL_CLEARANCE_MM - EPS;
}

function bestSpot(
  placed: PlacedFootprint[],
  w: number,
  h: number,
  sheet: number,
  config: ShapeBlockConfig
): { x: number; y: number } | null {
  const onSheet = placed.filter((p) => p.sheet === sheet);
  const xs = [config.sheetMarginMm];
  const ys = [config.sheetMarginMm];
  for (const p of onSheet) {
    xs.push(roundMm(p.x + p.w + config.blockGapMm));
    ys.push(roundMm(p.y + p.h + config.blockGapMm));
  }
  let best: { x: number; y: number } | null = null;
  for (const y of ys.sort((a, b) => a - b)) {
    for (const x of xs.sort((a, b) => a - b)) {
      if (!fitsSheet(x, y, w, h, config)) continue;
      const box = { x, y, w, h };
      // 0.05 mm absorbs rounding when an anchor is the neighbour's edge plus the gap.
      if (onSheet.some((p) => separation(box, p) < config.blockGapMm - 0.05)) continue;
      if (!best || y + h < best.y + h - EPS || (Math.abs(y + h - (best.y + h)) <= EPS && x < best.x)) best = { x, y };
    }
  }
  return best;
}

function placeOption(
  placed: PlacedFootprint[],
  option: { footW: number; footH: number },
  orderId: number | null,
  config: ShapeBlockConfig,
  soloSheet: boolean
): PlacedFootprint | null {
  const taken = new Set(soloSheet ? placed.filter((foot) => foot.orderId === orderId).map((foot) => foot.sheet) : []);
  const sheets = placed.length === 0 ? [0] : [...new Set(placed.map((p) => p.sheet))].sort((a, b) => a - b);
  for (const sheet of sheets) {
    if (taken.has(sheet)) continue;
    const spot = bestSpot(placed, option.footW, option.footH, sheet, config);
    if (spot) return { orderId, sheet, x: spot.x, y: spot.y, w: option.footW, h: option.footH };
  }
  const fresh = placed.length === 0 ? 0 : Math.max(...placed.map((p) => p.sheet)) + 1;
  const spot = bestSpot([], option.footW, option.footH, fresh, config);
  if (!spot) return null;
  return { orderId, sheet: fresh, x: spot.x, y: spot.y, w: option.footW, h: option.footH };
}

interface Choice<T> {
  block: BuiltBlock<T>;
  option: FootprintOption<T>;
  spot: PlacedFootprint;
}

function stateKey<T>(choices: Choice<T>[]): string {
  const sheets = new Map<number, number>();
  for (const choice of choices) {
    const bottom = choice.spot.y + choice.spot.h;
    sheets.set(choice.spot.sheet, Math.max(sheets.get(choice.spot.sheet) ?? 0, bottom));
  }
  const height = [...sheets.values()].reduce((sum, v) => sum + v, 0);
  return `${sheets.size}:${height.toFixed(2)}`;
}

function packBlocks<T>(blocks: BuiltBlock<T>[], config: ShapeBlockConfig): Choice<T>[] | null {
  const ordered = [...blocks].sort(
    (a, b) => b.maxArea - a.maxArea || (a.splitPart ?? 0) - (b.splitPart ?? 0) || String(a.orderId).localeCompare(String(b.orderId))
  );
  let beam: { choices: Choice<T>[]; placed: PlacedFootprint[] }[] = [{ choices: [], placed: [] }];
  for (const block of ordered) {
    const next: { choices: Choice<T>[]; placed: PlacedFootprint[] }[] = [];
    const seen = new Set<string>();
    for (const state of beam) {
      const options = config.allowBlockRotation ? block.options : block.options.filter((option) => option.blockRot === 0);
      for (const option of options) {
        const spot = placeOption(state.placed, option, block.orderId, config, block.soloSheet);
        if (!spot) continue;
        const choices = [...state.choices, { block, option, spot }];
        const key = `${stateKey(choices)}:${block.orderId}:${block.splitPart ?? 0}:${option.blockRot}:${spot.sheet}:${spot.x.toFixed(2)}:${spot.y.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ choices, placed: [...state.placed, spot] });
      }
    }
    next.sort((a, b) => compareChoices(a.choices, b.choices));
    beam = next.slice(0, 18);
    if (beam.length === 0) return null;
  }
  const choices = beam[0]?.choices ?? null;
  return choices ? pullOntoEarlierSheets(choices, config) : null;
}

/** A block that opened a new sheet is moved up if an earlier sheet still has a free strip. */
function pullOntoEarlierSheets<T>(choices: Choice<T>[], config: ShapeBlockConfig): Choice<T>[] {
  const order = [...choices].sort((a, b) => b.spot.sheet - a.spot.sheet || a.spot.h - b.spot.h);
  for (const choice of order) {
    const others = choices.filter((other) => other !== choice).map((other) => other.spot);
    for (let sheet = 0; sheet < choice.spot.sheet; sheet++) {
      const spot = bestSpot(others, choice.option.footW, choice.option.footH, sheet, config);
      if (!spot) continue;
      choice.spot = { ...choice.spot, sheet, x: spot.x, y: spot.y };
      break;
    }
  }
  return choices;
}

function compareChoices<T>(a: Choice<T>[], b: Choice<T>[]): number {
  const score = (choices: Choice<T>[]) => {
    const sheets = new Map<number, number>();
    for (const choice of choices) {
      sheets.set(choice.spot.sheet, Math.max(sheets.get(choice.spot.sheet) ?? 0, choice.spot.y + choice.spot.h));
    }
    const height = [...sheets.values()].reduce((sum, v) => sum + v, 0);
    const width = Math.max(0, ...choices.map((choice) => choice.spot.x + choice.spot.w));
    return [sheets.size, height, width] as const;
  };
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) if (Math.abs(sa[i] - sb[i]) > 0.01) return sa[i] - sb[i];
  return 0;
}

function sheetOutlineOf(polys: Pt[][], posX: number, posY: number): Pt[][] {
  return translatePolys(polys, posX, posY);
}

/** Move saved pieces until every cut line on a sheet is at least `clearance` apart. */
function separatePlaced<T>(placements: ShapeBlockPlacement<T>[], clearance: number): ShapeBlockPlacement<T>[] {
  const next = placements.map((piece) => ({
    ...piece,
    outline: piece.outline.map((poly) => poly.map((point) => ({ ...point }))),
  }));
  const shift = (piece: ShapeBlockPlacement<T>, dx: number, dy: number) => {
    piece.posX = roundMm(piece.posX + dx);
    piece.posY = roundMm(piece.posY + dy);
    piece.outline = translatePolys(piece.outline, dx, dy);
  };
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let i = 0; i < next.length && !moved; i++) {
      for (let j = i + 1; j < next.length; j++) {
        if (next[i].sheetIndex !== next[j].sheetIndex) continue;
        if (!outlinesTooClose(next[i].outline, next[j].outline, clearance)) continue;
        const ix = next[i].posX + next[i].width / 2;
        const jx = next[j].posX + next[j].width / 2;
        const iy = next[i].posY + next[i].height / 2;
        const jy = next[j].posY + next[j].height / 2;
        if (Math.abs(ix - jx) >= Math.abs(iy - jy)) shift(ix >= jx ? next[i] : next[j], 0.4, 0);
        else shift(iy >= jy ? next[i] : next[j], 0, 0.4);
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  return next;
}

function realize<T>(choice: Choice<T>, config: ShapeBlockConfig): { placements: ShapeBlockPlacement<T>[]; block: ShapeBlockInfo } {
  const { option, spot } = choice;
  const originX = spot.x + (option.side === "left" ? config.labelGutterMm : 0) + config.framePadMm;
  const originY = spot.y + config.framePadMm;
  const placements: ShapeBlockPlacement<T>[] = option.pieces.map((piece) => {
    const mapped = mapContentRect({ x: piece.x, y: piece.y, w: piece.w, h: piece.h }, option.blockRot, option.contentW, option.contentH);
    const posX = roundMm(originX + mapped.x);
    const posY = roundMm(originY + mapped.y);
    const rotationDeg = addTurns(piece.rot, option.blockRot);
    const turned = rotateOutline(outlineOf(piece.item), piece.item.width, piece.item.height, rotationDeg);
    return {
      item: piece.item,
      orderId: piece.item.orderId,
      sheetIndex: spot.sheet,
      posX,
      posY,
      width: roundMm(mapped.w),
      height: roundMm(mapped.h),
      rotated: rotationDeg === 90 || rotationDeg === 270,
      rotationDeg,
      outline: sheetOutlineOf(turned.polys, posX, posY),
      splitPart: choice.block.splitPart,
      splitCount: choice.block.splitCount,
    };
  });
  return {
    placements,
    block: {
      orderId: choice.block.orderId,
      sheetIndex: spot.sheet,
      blockRotation: option.blockRot,
      x: roundMm(spot.x),
      y: roundMm(spot.y),
      width: roundMm(spot.w),
      height: roundMm(spot.h),
      label: choice.block.label,
      splitPart: choice.block.splitPart,
      splitCount: choice.block.splitCount,
    },
  };
}

function groupOf<T>(items: ShapeBlockItem<T>[]): { orderId: number | null; items: ShapeBlockItem<T>[]; code: string }[] {
  const groups: { orderId: number | null; items: ShapeBlockItem<T>[]; code: string }[] = [];
  const byId = new Map<number, { orderId: number | null; items: ShapeBlockItem<T>[]; code: string }>();
  for (const item of items) {
    if (item.orderId === null || item.orderId === undefined) {
      groups.push({ orderId: null, items: [item], code: item.receiptCode ?? "" });
      continue;
    }
    const existing = byId.get(item.orderId);
    if (existing) existing.items.push(item);
    else {
      const group = { orderId: item.orderId, items: [item], code: item.receiptCode ?? "" };
      byId.set(item.orderId, group);
      groups.push(group);
    }
  }
  return groups;
}

type ReceiptGroup<T> = { orderId: number | null; items: ShapeBlockItem<T>[]; code: string };

function contentLimits(config: ShapeBlockConfig): { maxW: number; maxH: number } {
  const slack = config.labelGutterMm;
  const pad = config.framePadMm;
  return {
    maxW: config.sheetWidthMm - 2 * config.sheetMarginMm - 2 * pad - slack,
    maxH: config.sheetHeightMm - 2 * config.sheetMarginMm - 2 * pad - slack,
  };
}

function optionsFromLayouts<T>(layouts: LocalPiece<T>[][], config: ShapeBlockConfig): FootprintOption<T>[] {
  const options: FootprintOption<T>[] = [];
  const seen = new Map<string, number>();
  for (const laid of layouts) {
    for (const rot of [0, 90] as const) {
      const option = optionFrom(laid, rot, config);
      if (option.footW > config.sheetWidthMm - 2 * config.sheetMarginMm + EPS) continue;
      if (option.footH > config.sheetHeightMm - 2 * config.sheetMarginMm + EPS) continue;
      const key = `${option.footW.toFixed(0)}x${option.footH.toFixed(0)}`;
      // Same footprint: keep the layout that faces more than one way.
      const mix = new Set(laid.map((piece) => piece.rot)).size;
      const prev = seen.get(key);
      if (prev !== undefined && mix <= prev) continue;
      seen.set(key, mix);
      if (prev !== undefined) {
        const index = options.findIndex((have) => `${have.footW.toFixed(0)}x${have.footH.toFixed(0)}` === key);
        if (index >= 0) options.splice(index, 1);
      }
      options.push(option);
    }
  }
  return options;
}

function buildBlock<T>(group: ReceiptGroup<T>, config: ShapeBlockConfig, split: { part: number; count: number } | null, mode: LayoutMode): BuiltBlock<T> | null {
  const { maxW, maxH } = contentLimits(config);
  const layouts = layoutCandidates(group.items, maxW, maxH, config.cutClearanceMm, mode);
  const options = optionsFromLayouts(layouts, config);
  if (options.length === 0) return null;
  const label = split ? receiptPartLabel(group.code, split.part, split.count) : group.code;
  return {
    orderId: group.orderId,
    code: group.code,
    label,
    splitPart: split?.part ?? null,
    splitCount: split?.count ?? null,
    soloSheet: split != null,
    options,
    maxArea: Math.max(...options.map((option) => option.footW * option.footH)),
  };
}

/** Largest prefix of `items` whose shelf layout fits one sheet. 0 when even the first piece does not. */
function largestFittingPrefix<T>(items: ShapeBlockItem<T>[], config: ShapeBlockConfig): number {
  const { maxW, maxH } = contentLimits(config);
  const fits = (count: number) => layoutCandidates(items.slice(0, count), maxW, maxH, config.cutClearanceMm, "search").length > 0;
  if (items.length === 0 || !fits(1)) return 0;
  if (fits(items.length)) return items.length;
  let lo = 1;
  let hi = items.length;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/**
 * Largest prefix that still fits after the clearance repair (`finish`).
 * Used when a raw shelf claims the whole receipt fits but the repaired
 * layout does not. The whole set is already known not to fit.
 */
function largestFinishedPrefix<T>(group: ReceiptGroup<T>, items: ShapeBlockItem<T>[], config: ShapeBlockConfig): number {
  const fits = (count: number) => buildBlock({ ...group, items: items.slice(0, count) }, config, { part: 1, count: 2 }, "full") != null;
  if (items.length < 2 || !fits(1)) return 0;
  let lo = 1;
  let hi = items.length - 1;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/**
 * Fewest framed parts of a receipt that did not fit as one repaired block.
 * Returns null when a piece is larger than the sheet. Tag sheets that only
 * fail the slide pass use a slightly wider shelf gap so the cut lines stay
 * at least CUT_CLEARANCE_MM apart.
 */
function fewestParts<T>(group: ReceiptGroup<T>, config: ShapeBlockConfig): BuiltBlock<T>[] | null {
  const packing: ShapeBlockConfig = { ...config, cutClearanceMm: Math.round((config.cutClearanceMm + 0.2) * 1000) / 1000 };
  const blocks: BuiltBlock<T>[] = [];
  let rest = group.items;
  while (rest.length > 0) {
    let count = largestFittingPrefix(rest, packing);
    let chosen: BuiltBlock<T> | null = null;
    if (blocks.length === 0 && count >= rest.length) {
      count = largestFinishedPrefix(group, rest, config);
      if (count > 0) chosen = buildBlock({ ...group, items: rest.slice(0, count) }, config, { part: 1, count: 2 }, "full");
    } else {
      while (count > 0 && !chosen) {
        chosen = buildBlock({ ...group, items: rest.slice(0, count) }, packing, { part: 1, count: 2 }, "search");
        if (!chosen) count -= 1;
      }
    }
    if (!chosen || count <= 0) return null;
    blocks.push(chosen);
    rest = rest.slice(count);
  }
  if (blocks.length < 2) return null;
  const count = blocks.length;
  for (let index = 0; index < count; index++) {
    blocks[index].splitPart = index + 1;
    blocks[index].splitCount = count;
    blocks[index].soloSheet = true;
    blocks[index].label = receiptPartLabel(group.code, index + 1, count);
  }
  return blocks;
}

function receiptName<T>(group: ReceiptGroup<T>): string {
  return group.code || (group.orderId != null ? String(group.orderId) : "(tanpa nomor)");
}

export function runShapeBlockNesting<T>(items: ShapeBlockItem<T>[], partial?: Partial<ShapeBlockConfig>): ShapeBlockResult<T> {
  const config = resolveShapeConfig(partial);
  const errors: string[] = [];
  if (items.length === 0) {
    return { ok: true, errors, placements: [], blocks: [], sheetCount: 0, sumUsedHeight: 0, config };
  }

  const blocks: BuiltBlock<T>[] = [];

  for (const group of groupOf(items)) {
    const whole = buildBlock(group, config, null, "full");
    if (whole) {
      blocks.push(whole);
      continue;
    }
    const parts = fewestParts(group, config);
    if (!parts) {
      errors.push(
        `Resi ${receiptName(group)} tidak muat dalam satu lembar ${config.sheetWidthMm}×${config.sheetHeightMm} mm, dan ada keping yang lebih besar dari lembar. Resi tidak dipecah.`
      );
      continue;
    }
    blocks.push(...parts);
  }

  if (blocks.length === 0) {
    return { ok: false, errors, placements: [], blocks: [], sheetCount: 0, sumUsedHeight: 0, config };
  }

  const choices = packBlocks(blocks, config);
  if (!choices || choices.length !== blocks.length) {
    errors.push("Satu atau lebih blok resi tidak muat di lembar.");
    return { ok: false, errors, placements: [], blocks: [], sheetCount: 0, sumUsedHeight: 0, config };
  }

  const placements: ShapeBlockPlacement<T>[] = [];
  const placedBlocks: ShapeBlockInfo[] = [];
  for (const choice of choices) {
    const realized = realize(choice, config);
    placements.push(...realized.placements);
    placedBlocks.push(realized.block);
  }

  const sheets = new Map<number, number>();
  for (const block of placedBlocks) {
    sheets.set(block.sheetIndex, Math.max(sheets.get(block.sheetIndex) ?? 0, block.y + block.height));
  }
  // Keep the caller's item order in the flat list so a missing piece is obvious.
  const byId = new Map(placements.map((p) => [p.item, p]));
  const ordered = separatePlaced(
    items.map((item) => byId.get(item)).filter((p): p is ShapeBlockPlacement<T> => !!p),
    config.cutClearanceMm
  );

  return {
    ok: true,
    errors,
    placements: ordered,
    blocks: placedBlocks,
    sheetCount: sheets.size,
    sumUsedHeight: roundMm([...sheets.values()].reduce((sum, v) => sum + v, 0)),
    config,
  };
}
