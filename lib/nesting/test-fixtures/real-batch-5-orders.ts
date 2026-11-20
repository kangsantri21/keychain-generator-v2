/**
 * Real Production batch (BATCH-1019: 5 orders, 28 items) used to validate
 * the production spacing: item sizes (unrotated) and order ids only — no
 * names, no artwork. Taken from that batch's locked layout. Test-only.
 */
import type { GroupedNestingItem } from "../grouped-nesting-types";

/** [itemId, orderId, width, height] in mm, unrotated. */
const ROWS: [number, number, number, number][] = [
  [0, 90, 80.008, 26.212],
  [1, 90, 80.00699999999999, 26.207],
  [2, 90, 80.00399999999999, 26.204],
  [3, 90, 80.00099999999999, 26.201],
  [4, 90, 80.006, 26.197],
  [5, 90, 68.032, 26.2],
  [6, 90, 47.216, 26.205000000000002],
  [7, 94, 79.999, 32.052],
  [8, 94, 79.999, 32.052],
  [9, 94, 79.999, 32.052],
  [10, 94, 80.008, 25.883000000000003],
  [11, 94, 80.003, 25.883000000000003],
  [12, 94, 80.002, 25.883000000000003],
  [13, 93, 79.92699999999999, 31.763000000000005],
  [14, 93, 79.92699999999999, 31.763000000000005],
  [15, 93, 79.92699999999999, 31.763000000000005],
  [16, 93, 79.92699999999999, 31.763000000000005],
  [17, 92, 80.001, 25.948999999999998],
  [18, 92, 80.001, 25.948999999999998],
  [19, 92, 80.001, 25.948999999999998],
  [20, 92, 80, 25.948999999999998],
  [21, 92, 80, 25.948999999999998],
  [22, 91, 80, 20],
  [23, 91, 80, 20],
  [24, 91, 80, 19.985000000000003],
  [25, 91, 78.149, 20],
  [26, 91, 70.92, 21.8],
  [27, 91, 68.259, 21.324],
];

export function realBatch5Orders(): GroupedNestingItem<{ itemId: number }>[] {
  return ROWS.map(([id, orderId, width, height]) => ({
    id,
    orderId,
    width,
    height,
    originalWidth: width,
    originalHeight: height,
    allowRotation: true,
    data: { itemId: id },
  }));
}
