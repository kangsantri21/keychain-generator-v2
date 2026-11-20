import type { GroupedV2SlotReflow } from "@/lib/nesting/grouped-nesting-preview";
import type { FunnelCounts, SlotOutcome } from "@/lib/nesting/grouped-nesting-v3-funnel";

type Funnel = NonNullable<GroupedV2SlotReflow["funnel"]>;

/** Rows of the funnel table: a stage total, or one outcome (indented) explaining a drop. */
const ROWS: ({ stage: keyof Omit<FunnelCounts, "byReason">; label: string } | { reason: SlotOutcome; label: string })[] = [
  { stage: "detected", label: "Detected" },
  { reason: "SLOT_DEGENERATE", label: "HARD · slot degenerate (≤ 0 after ORDER_GAP)" },
  { reason: "SLOT_TOO_NARROW_FOR_ITEM", label: "HARD · too narrow for an item" },
  { reason: "SLOT_TOO_SHORT_FOR_ITEM", label: "HARD · too short for an item" },
  { reason: "ORDER_AREA_EXCEEDS_SLOT", label: "HARD · order area > slot area" },
  { stage: "geometryFeasible", label: "Geometry feasible" },
  { reason: "CANNOT_IMPROVE_OBJECTIVE", label: "HARD · cannot improve objective (bound)" },
  { stage: "objectiveFeasible", label: "Objective feasible" },
  { reason: "ORDER_RANK_CUTOFF", label: "SOFT · order ranking cutoff" },
  { reason: "ORDER_NOT_REACHED_BUDGET", label: "SOFT · order not reached (budget)" },
  { reason: "PER_ORDER_SLOT_CAP", label: "SOFT · per-order slot cap" },
  { reason: "SEARCH_BUDGET", label: "SOFT · search budget" },
  { stage: "attempted", label: "Actually tried" },
  { reason: "NO_ARRANGEMENT_FOUND", label: "tried · no arrangement fits" },
  { reason: "ONLY_NO_OP", label: "tried · only no-op" },
  { reason: "BUDGET_INTERRUPTED", label: "tried · budget interrupted" },
  { reason: "INVALID_PLACEMENT", label: "tried · invalid placement" },
  { reason: "NOT_BETTER", label: "tried · not better" },
  { reason: "BETTER_NOT_SELECTED", label: "tried · better, not the pass best" },
  { stage: "shapeFound", label: "Successful reflow / shape" },
  { stage: "validPlacement", label: "Global valid" },
  { stage: "strictlyBetter", label: "Strictly better" },
  { stage: "accepted", label: "Accepted" },
];

/**
 * V3A-2B DEV-only funnel: why each (order, slot) pair the slot search saw
 * did or did not reach evaluation. Read-only diagnostics, never exported.
 */
export function SlotFunnelPanel({ funnel }: { funnel: Funnel }) {
  const { foreign, self } = funnel;
  const num = (value: number | null, digits = 1) => (value === null ? "—" : value.toFixed(digits));

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded bg-white p-2">
        <span className="font-semibold text-slate-700">SLOT FUNNEL ({funnel.passes} pass)</span>
        <table className="mt-1 w-full whitespace-nowrap">
          <thead className="text-left text-slate-400">
            <tr>
              <th className="py-0.5 pr-4 font-medium">Stage / reason</th>
              <th className="py-0.5 pr-4 text-right font-medium">FOREIGN</th>
              <th className="py-0.5 text-right font-medium">SELF</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => {
              const isStage = "stage" in row;
              const value = (c: FunnelCounts) => (isStage ? c[row.stage] : c.byReason[row.reason]);
              return (
                <tr key={row.label} className={isStage ? "border-t border-slate-100 font-semibold text-slate-700" : "text-slate-500"}>
                  <td className={`py-0.5 pr-4 ${isStage ? "" : "pl-4"}`}>{row.label}</td>
                  <td className="py-0.5 pr-4 text-right">{value(foreign)}</td>
                  <td className="py-0.5 text-right">{value(self)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-slate-200 font-semibold text-slate-700">
              <td className="py-0.5 pr-4">Hard pruned (geometry + objective)</td>
              <td className="py-0.5 pr-4 text-right">{foreign.hardGeometry + foreign.hardObjective}</td>
              <td className="py-0.5 text-right">{self.hardGeometry + self.hardObjective}</td>
            </tr>
            <tr className="font-semibold text-slate-700">
              <td className="py-0.5 pr-4">Soft pruned (ranking / cap / budget)</td>
              <td className="py-0.5 pr-4 text-right">{foreign.soft}</td>
              <td className="py-0.5 text-right">{self.soft}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded bg-white p-2">
        <span className="font-semibold text-slate-700">PER ORDER (summed over passes)</span>
        <table className="mt-1 w-full whitespace-nowrap">
          <thead className="text-left text-slate-400">
            <tr>
              {["Order", "Current W×H", "Area", "Passes", "F seen", "F geom ok", "F obj ok", "F tried", "F shape", "F valid", "F better", "S tried", "S better", "Accepted"].map(
                (h) => (
                  <th key={h} className="py-0.5 pr-3 font-medium">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {funnel.orders.map((o) => (
              <tr key={o.orderKey} className="border-t border-slate-100">
                <td className="py-0.5 pr-3">{o.receiptCode ?? `Order #${o.orderId ?? "-"}`}</td>
                <td className="py-0.5 pr-3">
                  {o.currentWidth.toFixed(1)} × {o.currentHeight.toFixed(1)}
                </td>
                <td className="py-0.5 pr-3">{o.area.toFixed(0)}</td>
                <td className="py-0.5 pr-3">{o.passesSearched}</td>
                <td className="py-0.5 pr-3">{o.foreign.seen}</td>
                <td className="py-0.5 pr-3">{o.foreign.geometryFeasible}</td>
                <td className="py-0.5 pr-3">{o.foreign.objectiveFeasible}</td>
                <td className="py-0.5 pr-3">{o.foreign.tried}</td>
                <td className="py-0.5 pr-3">{o.foreign.shapeFound}</td>
                <td className="py-0.5 pr-3">{o.foreign.valid}</td>
                <td className="py-0.5 pr-3">{o.foreign.better}</td>
                <td className="py-0.5 pr-3">{o.self.tried}</td>
                <td className="py-0.5 pr-3">{o.self.better}</td>
                <td className="py-0.5 pr-3">{o.foreign.accepted + o.self.accepted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded bg-white p-2">
        <span className="font-semibold text-slate-700">TOP PRUNED FOREIGN CANDIDATES (never tried)</span>
        {funnel.topPrunedForeign.length === 0 ? (
          <span className="block text-slate-400">Tidak ada.</span>
        ) : (
          <table className="mt-1 w-full whitespace-nowrap">
            <thead className="text-left text-slate-400">
              <tr>
                {["#", "Order", "Pass", "Target", "Slot x,y", "Slot W×H", "Order W×H", "Reason", "Class", "Area ratio", "Bound Δ mm"].map((h) => (
                  <th key={h} className="py-0.5 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funnel.topPrunedForeign.map((c) => (
                <tr key={c.rank} className="border-t border-slate-100">
                  <td className="py-0.5 pr-3">{c.rank}</td>
                  <td className="py-0.5 pr-3">{c.receiptCode ?? `Order #${c.orderId ?? "-"}`}</td>
                  <td className="py-0.5 pr-3">{c.pass + 1}</td>
                  <td className="py-0.5 pr-3">Sheet {c.sheetIndex + 1}</td>
                  <td className="py-0.5 pr-3">
                    {c.slot.x.toFixed(1)}, {c.slot.y.toFixed(1)}
                  </td>
                  <td className="py-0.5 pr-3">
                    {c.slot.width.toFixed(1)} × {c.slot.height.toFixed(1)}
                  </td>
                  <td className="py-0.5 pr-3">
                    {c.orderWidth.toFixed(1)} × {c.orderHeight.toFixed(1)}
                  </td>
                  <td className="py-0.5 pr-3">{c.outcome}</td>
                  <td className="py-0.5 pr-3">{c.outcomeClass}</td>
                  <td className="py-0.5 pr-3">{num(c.areaRatio, 2)}</td>
                  <td className="py-0.5 pr-3">{num(c.boundDeltaMm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <span className="mt-1 block text-slate-400">
          Bound Δ = tinggi total jika footprint terkecil yang mungkin dari order itu ditaruh di slot, dikurangi tinggi saat ini (≥ 0 = tidak mungkin menghemat). Index
          sheet = penomoran pada pass tersebut.
        </span>
      </div>
    </div>
  );
}
