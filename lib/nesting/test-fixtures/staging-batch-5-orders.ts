/**
 * Real Production staging batch (5 orders, 27 items — the Staging sheet
 * reviewed for receipt compaction): item sizes (unrotated), order ids and
 * receipt codes only — no names, no artwork. Item order = staging id order.
 * Test-only.
 */
import type { GroupedNestingItem } from "../grouped-nesting-types";

/** [itemId, orderId, width, height] in mm, unrotated. */
const ROWS: [number, number, number, number][] = [
  [1049, 96, 80.002, 26.212],
  [1050, 96, 80.00399999999999, 26.21],
  [1051, 96, 77.091, 26.206],
  [1052, 96, 66.096, 26.21],
  [1053, 99, 79.92699999999999, 31.763000000000005],
  [1054, 99, 79.92699999999999, 31.763000000000005],
  [1055, 99, 79.92699999999999, 31.763000000000005],
  [1056, 99, 79.92699999999999, 31.763000000000005],
  [1057, 99, 79.92699999999999, 31.763000000000005],
  [1058, 99, 79.379, 19.98],
  [1059, 99, 75.289, 19.979999999999997],
  [1060, 99, 64.38900000000001, 20],
  [1061, 99, 37.699, 19.96],
  [1062, 99, 26.299, 19.98],
  [1063, 99, 24.579, 19.99],
  [1064, 97, 72.949, 19.955000000000002],
  [1065, 97, 63.589999999999996, 19.97],
  [1066, 97, 57.964000000000006, 19.959999999999997],
  [1067, 97, 51.894000000000005, 19.959999999999997],
  [1068, 98, 80, 25.948999999999998],
  [1069, 98, 80, 25.883000000000003],
  [1070, 98, 79.89399999999999, 25.883000000000003],
  [1071, 98, 78.31, 25.883000000000003],
  [1072, 98, 72.839, 25.948999999999998],
  [1073, 98, 70.523, 25.948999999999998],
  [1074, 98, 69.839, 25.948999999999998],
  [1075, 95, 66.617, 26.217],
];

export const STAGING_BATCH_RECEIPT_CODES: Record<number, string> = {
  96: "Test091",
  99: "Tes095",
  97: "Test092",
  98: "Tes903",
  95: "PROD-APPEND-TEST",
};

export function stagingBatch5Orders(): GroupedNestingItem<{ itemId: number }>[] {
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
