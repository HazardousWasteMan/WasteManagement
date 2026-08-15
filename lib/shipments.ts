export type ShipmentStatus = "booked" | "in_transit" | "delivered";
export type TransportMode = "truck" | "rail" | "barge" | "vessel";

export interface Shipment {
  id: string;
  analysisName: string;
  depotId: string;
  mode: TransportMode;
  createdAt: number;
}

// ponytail: demo origin is a fixed site; real version takes pickup location from the order
export const ORIGIN = { lat: 59.91, lng: 10.75, label: "Your site (Oslo)" };

// rough public emission factors, g CO2 per tonne-km
export const MODES: Record<TransportMode, { label: string; gPerTonneKm: number }> = {
  truck: { label: "Truck (ADR)", gPerTonneKm: 62 },
  barge: { label: "River barge", gPerTonneKm: 31 },
  rail: { label: "Railway", gPerTonneKm: 22 },
  vessel: { label: "Seagoing vessel", gPerTonneKm: 8 },
};

export const ASSUMED_LOAD_TONNES = 25;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function co2Kg(mode: TransportMode, km: number, tonnes: number = ASSUMED_LOAD_TONNES): number {
  return Math.round((MODES[mode].gPerTonneKm * km * tonnes) / 1000);
}

const IN_TRANSIT_AFTER_MS = 45_000;
const DELIVERED_AFTER_MS = 180_000;

// ponytail: same elapsed-time simulation as lib/analyses.ts; swap for carrier tracking when real
export function computeShipmentStatus(createdAt: number, now: number = Date.now()): ShipmentStatus {
  const age = now - createdAt;
  if (age >= DELIVERED_AFTER_MS) return "delivered";
  if (age >= IN_TRANSIT_AFTER_MS) return "in_transit";
  return "booked";
}

function seeds(now: number): Shipment[] {
  const day = 86_400_000;
  return [
    // match the analysis seeds: depots below are licensed for the seed's avfallsstoffnr
    { id: "ship-seed-1", analysisName: "Spillolje — verkstedtank Alnabru", depotId: "1508.0042.01", mode: "vessel", createdAt: now - 2 * day },
    { id: "ship-seed-2", analysisName: "Oljeforurenset masse — tankgrav Sandnes", depotId: "5544.0010.01", mode: "truck", createdAt: now - 60_000 },
  ];
}

const KEY = "shipments-v2"; // v2: depot ids switched from dummy to real anleggsnummer
let memory: Shipment[] | null = null;

function hasStorage(): boolean {
  return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function";
}

function load(): Shipment[] {
  if (!hasStorage()) {
    if (!memory) memory = seeds(Date.now());
    return memory;
  }
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as Shipment[];
    } catch {
      // fall through to reseed
    }
  }
  const fresh = seeds(Date.now());
  localStorage.setItem(KEY, JSON.stringify(fresh));
  return fresh;
}

function save(all: Shipment[]) {
  if (!hasStorage()) {
    memory = all;
    return;
  }
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function listShipments(): Shipment[] {
  return [...load()].sort((a, b) => b.createdAt - a.createdAt);
}

export function addShipment(input: { analysisName: string; depotId: string; mode: TransportMode }): Shipment {
  const shipment: Shipment = {
    id: crypto.randomUUID(),
    ...input,
    createdAt: Date.now(),
  };
  save([...load(), shipment]);
  return shipment;
}

export function __resetForTests() {
  memory = null;
  if (hasStorage()) localStorage.removeItem(KEY);
}
