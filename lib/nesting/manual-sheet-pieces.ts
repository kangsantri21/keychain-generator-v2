/**
 * Names read off Rofiq's manual sheet (docs/reference/contoh-nesting-manual.jpg).
 *
 * The photo is the back-print, so it was read after a horizontal flip.
 * Grouping follows the framed blocks and the receipt code printed beside each
 * block. A few spellings are the closest reading of a bubbly font (Rasqa,
 * Hagan, Cleona). Cup labels that sit upside-down on the sheet are still
 * one piece each.
 */
export type ManualKind = "text" | "character" | "cup" | "badge";

export interface ManualPiece {
  orderId: number;
  code: string;
  name: string;
  kind: ManualKind;
}

interface Receipt {
  code: string;
  pieces: { name: string; kind: ManualKind }[];
}

const RECEIPTS: Receipt[] = [
  {
    code: "260421DTWVGR82",
    pieces: [
      "Ammara", "Jasmine", "Marsha", "Rasqa", "Abyan", "Naura", "Naura", "Aisha", "Faran", "Labib", "Dipta", "Azka", "Aira", "Rafa", "Seva", "Hurin", "Aulia", "Husna",
    ].map((name) => ({ name, kind: "text" as const })),
  },
  {
    code: "260422F3F79CYF",
    pieces: ["Shanum", "Izzatul", "Jannah", "Malika", "Dwi Margo", "Damar", "Hagan", "Zydan", "Dhara", "Edgar", "Arifa"].map((name) => ({
      name,
      kind: "text" as const,
    })),
  },
  {
    code: "260422FFRAEW",
    pieces: ["Rendra", "Rindra", "Fahim", "Faiza"].map((name) => ({ name, kind: "text" as const })),
  },
  {
    code: "260422FVPE98T",
    pieces: ["Mikhayla", "Cleona", "Keshwari"].map((name) => ({ name, kind: "character" as const })),
  },
  {
    code: "260422FVP6THM6",
    pieces: ["Rasya", "Rasya"].map((name) => ({ name, kind: "character" as const })),
  },
  {
    code: "260423HDDWEG36",
    pieces: [
      { name: "Auri", kind: "text" },
      { name: "Ezra", kind: "text" },
      { name: "Mezza", kind: "character" },
      { name: "Mezza", kind: "character" },
      { name: "Alea", kind: "character" },
      { name: "Alea", kind: "character" },
      { name: "Nabila", kind: "text" },
      { name: "Nabila", kind: "text" },
      { name: "Sultan", kind: "text" },
      { name: "Rijantan", kind: "badge" },
      { name: "Rijantan", kind: "badge" },
    ],
  },
  {
    code: "260422FOMCQRTW",
    pieces: ["Dina", "Fakhira", "Azizah", "Durratul", "Jihan", "Zuhrah", "Fatimah", "Wardah", "Mutia", "Zahra", "Liyana", "Nur", "Salsabila", "Talitha"].map(
      (name) => ({ name, kind: "cup" as const })
    ),
  },
];

export function manualSheetPieces(): ManualPiece[] {
  const pieces: ManualPiece[] = [];
  RECEIPTS.forEach((receipt, orderId) => {
    for (const piece of receipt.pieces) {
      pieces.push({ orderId: orderId + 1, code: receipt.code, name: piece.name, kind: piece.kind });
    }
  });
  return pieces;
}
