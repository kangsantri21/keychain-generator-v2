/**
 * Accepted Production layout (Staging sheet visually approved after the
 * 2 / 2 mm receipt gaps + compaction): FINAL placements exactly as staged —
 * ids, order ids, positions, on-sheet footprints, rotation and receipt
 * codes. No names, no artwork. Test-only acceptance fixture for the active
 * production frame (positions must never change).
 */

/** [id, orderId, posX, posY, width, height, rotated] — sheet mm, on-sheet footprint. */
const ROWS: [number, number, number, number, number, number, boolean][] = [
  [1102, 96, 114.88300000000001, 146.032, 80.002, 26.212, false],
  [1103, 96, 196.885, 146.032, 80.00399999999999, 26.21, false],
  [1104, 96, 196.885, 174.24200000000002, 77.091, 26.206, false],
  [1105, 96, 114.88300000000001, 174.244, 66.096, 26.21, false],
  [1106, 99, 114.88300000000001, 13, 31.763000000000005, 79.92699999999999, true],
  [1107, 99, 114.88300000000001, 94.92699999999999, 79.92699999999999, 31.763000000000005, false],
  [1108, 99, 148.64600000000002, 13, 31.763000000000005, 79.92699999999999, true],
  [1109, 99, 182.40900000000002, 13, 31.763000000000005, 79.92699999999999, true],
  [1110, 99, 216.17200000000003, 13, 79.92699999999999, 31.763000000000005, false],
  [1111, 99, 216.17200000000003, 46.763000000000005, 79.379, 19.98, false],
  [1112, 99, 216.17200000000003, 68.74300000000001, 19.979999999999997, 75.289, true],
  [1113, 99, 238.15200000000002, 68.74300000000001, 64.38900000000001, 20, false],
  [1114, 99, 238.15200000000002, 90.74300000000001, 19.96, 37.699, true],
  [1115, 99, 260.112, 90.74300000000001, 26.299, 19.98, false],
  [1116, 99, 260.112, 112.72300000000001, 19.99, 24.579, true],
  [1117, 97, 5, 202.454, 72.949, 19.955000000000002, false],
  [1118, 97, 79.949, 202.454, 63.589999999999996, 19.97, false],
  [1119, 97, 145.539, 202.454, 57.964000000000006, 19.959999999999997, false],
  [1120, 97, 205.503, 202.454, 51.894000000000005, 19.959999999999997, false],
  [1121, 98, 5, 13, 80, 25.948999999999998, false],
  [1122, 98, 87, 13, 25.883000000000003, 80, true],
  [1123, 98, 5, 40.949, 79.89399999999999, 25.883000000000003, false],
  [1124, 98, 5, 68.832, 78.31, 25.883000000000003, false],
  [1125, 98, 85.31, 95, 25.948999999999998, 72.839, true],
  [1126, 98, 5, 96.715, 70.523, 25.948999999999998, false],
  [1127, 98, 5, 124.664, 69.839, 25.948999999999998, false],
];

export const ACCEPTED_LAYOUT_RECEIPT_CODES: Record<number, string> = {
  96: "Test091",
  99: "Tes095",
  97: "Test092",
  98: "Tes903",
};

export function acceptedProductionLayout() {
  return ROWS.map(([id, orderId, posX, posY, width, height, rotated]) => ({
    id,
    orderId,
    posX,
    posY,
    width,
    height,
    rotated,
    status: "staged-production",
    order: { receiptCode: ACCEPTED_LAYOUT_RECEIPT_CODES[orderId] },
  }));
}
