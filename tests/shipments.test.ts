import { describe, it, expect, beforeEach } from "vitest";
import {
  computeShipmentStatus,
  haversineKm,
  co2Kg,
  MODES,
  listShipments,
  addShipment,
  __resetForTests,
} from "@/lib/shipments";

describe("computeShipmentStatus", () => {
  const t0 = 1_000_000;
  it("is 'booked' right after creation", () => {
    expect(computeShipmentStatus(t0, t0 + 10_000)).toBe("booked");
  });
  it("is 'in_transit' after 45 seconds", () => {
    expect(computeShipmentStatus(t0, t0 + 46_000)).toBe("in_transit");
  });
  it("is 'delivered' after 3 minutes", () => {
    expect(computeShipmentStatus(t0, t0 + 181_000)).toBe("delivered");
  });
});

describe("haversineKm", () => {
  it("Oslo to Rotterdam is roughly 900-1000 km", () => {
    const km = haversineKm(59.91, 10.75, 51.92, 4.48);
    expect(km).toBeGreaterThan(850);
    expect(km).toBeLessThan(1050);
  });
});

describe("co2Kg", () => {
  it("ranks vessel < rail < barge < truck for the same route", () => {
    const kms = 900;
    const [vessel, rail, barge, truck] = (["vessel", "rail", "barge", "truck"] as const).map(m => co2Kg(m, kms));
    expect(vessel).toBeLessThan(rail);
    expect(rail).toBeLessThan(barge);
    expect(barge).toBeLessThan(truck);
  });
  it("every mode has a label and factor", () => {
    for (const mode of Object.values(MODES)) {
      expect(mode.label.length).toBeGreaterThan(0);
      expect(mode.gPerTonneKm).toBeGreaterThan(0);
    }
  });
});

describe("shipments store", () => {
  beforeEach(() => __resetForTests());

  it("seeds shipments so the page is never empty", () => {
    expect(listShipments().length).toBeGreaterThanOrEqual(2);
  });

  it("addShipment persists a booked shipment for a depot", () => {
    const s = addShipment({ analysisName: "Sample X", depotId: "3107.0259.01", mode: "vessel" });
    expect(computeShipmentStatus(s.createdAt, Date.now())).toBe("booked");
    expect(listShipments().some(x => x.id === s.id)).toBe(true);
    expect(s.depotId).toBe("3107.0259.01");
  });
});
