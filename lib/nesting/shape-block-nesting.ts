/**
 * Shape-block nesting (P0.4–P0.6).
 *
 * One receipt is one block. Inside the block, pieces are placed by their
 * cut outline (a rectangle when no outline was given) and may turn 0/90/180/270.
 * 180° is a different outline even though the box does not change, so a notch
 * can receive the neighbouring piece. The whole block may then turn 90° if
 * that makes the sheet shorter. A thin frame and one receipt code sit in a
 * gutter reserved beside the frame — the code is not dropped into a hole.
 *
 * Bounding boxes of pieces in the same receipt may overlap. The cut lines
 * stay at least `cutClearanceMm` apart. Pieces from two receipts never share
 * a block.
 */
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
  rectOutline,
  rotateOutline,
  roundMm,
  translatePolys,
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
  options: FootprintOption<T>[];
  maxArea: number;
}

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

function pieceAt<T>(item: ShapeBlockItem<T>, rot: QuarterTurn, x: number, y: number): LocalPiece<T> {
  const turned = rotateOutline(outlineOf(item), item.width, item.height, rot);
  return { item, x, y, rot, w: turned.width, h: turned.height, polys: turned.polys };
}

function keyBefore(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > EPS) return a[i] < b[i];
  return false;
}

function rectsApart(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, gap: number): boolean {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return dx >= gap - EPS || dy >= gap - EPS;
}

function polysAt(piece: LocalPiece<unknown>, x: number, y: number): Pt[][] {
  return translatePolys(piece.polys, x, y);
}

function hitsPiece(piece: LocalPiece<unknown>, x: number, y: number, others: LocalPiece<unknown>[], clearance: number): boolean {
  const box = { x, y, w: piece.w, h: piece.h };
  const moved = polysAt(piece, x, y);
  for (const other of others) {
    if (other === piece) continue;
    const otherBox = { x: other.x, y: other.y, w: other.w, h: other.h };
    // Outlines live inside their boxes, so a wide box gap is already safe.
    if (rectsApart(box, otherBox, clearance)) continue;
    if (outlinesTooClose(moved, polysAt(other, other.x, other.y), clearance)) return true;
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
  for (let i = 0; i < 14; i++) {
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
    const piece = pieceAt(item, rot, 0, 0);
    if (piece.h > maxH + EPS || piece.w > maxW + EPS) {
      const other = item.allowRotation ? pieceAt(item, addTurns(rot, 90), 0, 0) : null;
      if (!other || other.h > maxH + EPS || other.w > maxW + EPS) return null;
      piece.rot = other.rot;
      piece.w = other.w;
      piece.h = other.h;
      piece.polys = other.polys;
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
    let bestKey: [number, number, number, number] | null = null;
    for (const rot of rots) {
      const proto = pieceAt(item, rot, 0, 0);
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
          const key: [number, number, number, number] = [bottom, right, y, x];
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

function finish<T>(pieces: LocalPiece<T>[] | null, clearance: number): LocalPiece<T>[] | null {
  if (!pieces || pieces.length === 0) return null;
  let slid = slidePieces(pieces, clearance);
  slid = flipPass(slid, clearance);
  return slid;
}

function flipPass<T>(pieces: LocalPiece<T>[], clearance: number): LocalPiece<T>[] {
  let best = pieces;
  const trials: LocalPiece<T>[][] = [];
  if (pieces.length <= 10) {
    for (let i = 0; i < pieces.length; i++) {
      if (!pieces[i].item.allowRotation) continue;
      trials.push(pieces.map((p, index) => (index === i ? flipped(p) : p)));
    }
  }
  trials.push(pieces.map((p, index) => (index % 2 === 1 && p.item.allowRotation ? flipped(p) : p)));
  for (const trial of trials) {
    const slid = slidePieces(trial, clearance);
    if (sizeOf(slid).area + 0.5 < sizeOf(best).area) best = slid;
  }
  return best;
}

function flipped<T>(piece: LocalPiece<T>): LocalPiece<T> {
  const rot = addTurns(piece.rot, 180);
  const next = pieceAt(piece.item, rot, piece.x, piece.y);
  return next;
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
    let piece = pieceAt(item, rot, 0, 0);
    if (piece.w > maxW + EPS) {
      if (!item.allowRotation) return null;
      const turned = pieceAt(item, addTurns(rot, 90), 0, 0);
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
function layoutCandidates<T>(items: ShapeBlockItem<T>[], maxW: number, maxH: number, clearance: number): LocalPiece<T>[][] {
  const gap = clearance;
  const heights = [maxH, maxH * 0.62, maxH * 0.4];
  const raw: (LocalPiece<T>[] | null)[] = [
    rowShelf(items, () => 0, maxW, gap),
    rowShelf(items, (_item, index) => oddTurn(index), maxW, gap),
    rowShelf(items, (item) => baseRot(item), maxW, gap),
    rowShelf(items, (item, index) => addTurns(baseRot(item), oddTurn(index)), maxW, gap),
    outlineNest(items, maxW, maxH, gap),
  ];
  for (const limit of heights) {
    raw.push(stackLayout(items, () => 0, limit, maxW, gap));
    raw.push(stackLayout(items, (item) => baseRot(item), limit, maxW, gap));
  }
  const finished: LocalPiece<T>[][] = [];
  for (const candidate of raw) {
    const done = finish(candidate, clearance);
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
  pareto.sort((a, b) => {
    const ra = materialRank(sizeOf(a).w, sizeOf(a).h, maxW, maxH)!;
    const rb = materialRank(sizeOf(b).w, sizeOf(b).h, maxW, maxH)!;
    return ra[0] - rb[0] || ra[1] - rb[1];
  });
  return pareto.slice(0, 4);
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
  config: ShapeBlockConfig
): PlacedFootprint | null {
  const sheets = placed.length === 0 ? [0] : [...new Set(placed.map((p) => p.sheet))].sort((a, b) => a - b);
  for (const sheet of sheets) {
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
  const ordered = [...blocks].sort((a, b) => b.maxArea - a.maxArea || String(a.orderId).localeCompare(String(b.orderId)));
  let beam: { choices: Choice<T>[]; placed: PlacedFootprint[] }[] = [{ choices: [], placed: [] }];
  for (const block of ordered) {
    const next: { choices: Choice<T>[]; placed: PlacedFootprint[] }[] = [];
    const seen = new Set<string>();
    for (const state of beam) {
      const options = config.allowBlockRotation ? block.options : block.options.filter((option) => option.blockRot === 0);
      for (const option of options) {
        const spot = placeOption(state.placed, option, block.orderId, config);
        if (!spot) continue;
        const choices = [...state.choices, { block, option, spot }];
        const key = `${stateKey(choices)}:${block.orderId}:${option.blockRot}:${spot.sheet}:${spot.x.toFixed(2)}:${spot.y.toFixed(2)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ choices, placed: [...state.placed, spot] });
      }
    }
    next.sort((a, b) => compareChoices(a.choices, b.choices));
    beam = next.slice(0, 12);
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

export function runShapeBlockNesting<T>(items: ShapeBlockItem<T>[], partial?: Partial<ShapeBlockConfig>): ShapeBlockResult<T> {
  const config = resolveShapeConfig(partial);
  const errors: string[] = [];
  if (items.length === 0) {
    return { ok: true, errors, placements: [], blocks: [], sheetCount: 0, sumUsedHeight: 0, config };
  }

  const gutterSlack = config.labelGutterMm;
  const pad = config.framePadMm;
  const maxW = config.sheetWidthMm - 2 * config.sheetMarginMm - 2 * pad - gutterSlack;
  const maxH = config.sheetHeightMm - 2 * config.sheetMarginMm - 2 * pad - gutterSlack;
  const blocks: BuiltBlock<T>[] = [];

  for (const group of groupOf(items)) {
    const layouts = layoutCandidates(group.items, maxW, maxH, config.cutClearanceMm);
    if (layouts.length === 0) {
      errors.push(
        `Resi ${group.code || group.orderId || "(tanpa nomor)"} tidak muat dalam satu lembar ${config.sheetWidthMm}×${config.sheetHeightMm} mm. Resi tidak dipecah.`
      );
      continue;
    }
    const options: FootprintOption<T>[] = [];
    const seen = new Set<string>();
    for (const laid of layouts) {
      for (const rot of [0, 90] as const) {
        const option = optionFrom(laid, rot, config);
        if (option.footW > config.sheetWidthMm - 2 * config.sheetMarginMm + EPS) continue;
        if (option.footH > config.sheetHeightMm - 2 * config.sheetMarginMm + EPS) continue;
        const key = `${option.footW.toFixed(0)}x${option.footH.toFixed(0)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push(option);
      }
    }
    if (options.length === 0) {
      errors.push(
        `Resi ${group.code || group.orderId || "(tanpa nomor)"} tidak muat dalam satu lembar ${config.sheetWidthMm}×${config.sheetHeightMm} mm. Resi tidak dipecah.`
      );
      continue;
    }
    blocks.push({
      orderId: group.orderId,
      code: group.code,
      options,
      maxArea: Math.max(...options.map((option) => option.footW * option.footH)),
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors, placements: [], blocks: [], sheetCount: 0, sumUsedHeight: 0, config };
  }

  const choices = packBlocks(blocks, config);
  if (!choices || choices.length !== blocks.length) {
    errors.push("Satu atau lebih blok resi tidak muat di lembar tanpa memecah resi.");
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
  const ordered = items.map((item) => byId.get(item)).filter((p): p is ShapeBlockPlacement<T> => !!p);

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
