/**
 * PHASE 2B — TEST B, C, D for the pure API-response -> preview-sheet
 * conversion (see grouped-nesting-preview.ts's own top doc comment for why
 * this is tested as a plain function rather than through a rendered
 * component — this project has no component-testing framework).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildGroupedV2PreviewSheet, type GroupedV2ApiResponse } from "./grouped-nesting-preview";

function mockResponse(overrides: Partial<GroupedV2ApiResponse> = {}): GroupedV2ApiResponse {
  return {
    mode: "grouped-v2",
    dryRun: true,
    groups: [
      { orderId: 1, receiptCode: "RESI-A", x: 5, y: 5, width: 40, height: 20, itemCount: 2 },
      { orderId: 2, receiptCode: null, x: 60, y: 5, width: 30, height: 15, itemCount: 1 },
    ],
    items: [
      { orderId: 1, x: 5, y: 5, width: 20, height: 20, rotated: false, groupX: 5, groupY: 5, groupWidth: 40, groupHeight: 20, customerName: "Ana", templateId: 10, render: null },
      { orderId: 1, x: 27, y: 5, width: 18, height: 20, rotated: false, groupX: 5, groupY: 5, groupWidth: 40, groupHeight: 20, customerName: "Budi", templateId: 10, render: null },
      { orderId: 2, x: 60, y: 5, width: 30, height: 15, rotated: false, groupX: 60, groupY: 5, groupWidth: 30, groupHeight: 15, customerName: "Cici", templateId: 11, render: null },
    ],
    metrics: {
      totalItems: 3,
      totalOrders: 2,
      usedWidth: 90,
      usedHeight: 25,
      usedArea: 2250,
      totalItemArea: 1150,
      packingUtilizationPercent: 51.1,
      wastePercent: 48.9,
    },
    warnings: [],
    unfitCount: 0,
    ...overrides,
  };
}

describe("TEST B — response converts into renderable preview item positions", () => {
  test("every item gets posX/posY (matching StagingItemPayload's own field naming, not x/y)", () => {
    const preview = buildGroupedV2PreviewSheet(mockResponse());
    for (const item of preview.items) {
      assert.equal(typeof item.posX, "number");
      assert.equal(typeof item.posY, "number");
    }
    assert.equal(preview.items[0].posX, 5);
    assert.equal(preview.items[0].posY, 5);
  });
});

describe("TEST C — rendered item count matches input item count", () => {
  test("no item is dropped or duplicated by the conversion", () => {
    const response = mockResponse();
    const preview = buildGroupedV2PreviewSheet(response);
    assert.equal(preview.items.length, response.items.length);
  });
});

describe("TEST D — exactly one label per group, no per-item label", () => {
  test("group label count matches group count, one field each", () => {
    const preview = buildGroupedV2PreviewSheet(mockResponse());
    assert.equal(preview.groups.length, 2);
    for (const group of preview.groups) {
      assert.equal(typeof group.label, "string");
      assert.ok(group.label.length > 0);
    }
  });

  test("receiptCode is preferred; missing receiptCode falls back to 'Order #<id>'", () => {
    const preview = buildGroupedV2PreviewSheet(mockResponse());
    assert.equal(preview.groups[0].label, "RESI-A");
    assert.equal(preview.groups[1].label, "Order #2");
  });

  test("preview items carry no per-item label field at all (unlike legacy's per-item receipt label)", () => {
    const preview = buildGroupedV2PreviewSheet(mockResponse());
    for (const item of preview.items) {
      assert.equal("label" in item, false);
      assert.equal("receiptCode" in item, false);
    }
  });
});
