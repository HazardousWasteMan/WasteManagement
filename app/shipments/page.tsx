"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Chip } from "@heroui/react";
import { DEPOTS } from "@/lib/depots";
import {
  listShipments,
  computeShipmentStatus,
  ORIGIN,
  MODES,
  haversineKm,
  co2Kg,
  type Shipment,
  type ShipmentStatus,
} from "@/lib/shipments";
import type { MapRoute } from "@/components/dashboard/DepotMap";

const DepotMap = dynamic(() => import("@/components/dashboard/DepotMap"), { ssr: false });

const STATUS_LABEL: Record<ShipmentStatus, string> = {
  booked: "Pickup booked",
  in_transit: "In transit",
  delivered: "Delivered",
};

const STATUS_COLOR: Record<ShipmentStatus, "default" | "warning" | "success"> = {
  booked: "default",
  in_transit: "warning",
  delivered: "success",
};

const ROUTE_COLOR: Record<ShipmentStatus, string> = {
  booked: "#94a3b8",
  in_transit: "#d97706",
  delivered: "#65a30d",
};

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [now, setNow] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setShipments(listShipments());
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tick);
  }, []);

  if (!now) return null; // localStorage is client-only

  const rows = shipments.map(s => {
    const depot = DEPOTS.find(d => d.id === s.depotId);
    return { ...s, depot, status: computeShipmentStatus(s.createdAt, now) };
  });

  // ponytail: fall back to the first shipment so the map is never empty
  const activeId = selectedId ?? rows[0]?.id ?? null;

  const routes: MapRoute[] = rows
    .filter(r => r.depot && r.id === activeId)
    .map(r => ({
      from: [ORIGIN.lat, ORIGIN.lng],
      to: [r.depot!.lat, r.depot!.lng],
      label: `${r.analysisName} → ${r.depot!.name} (${STATUS_LABEL[r.status]})`,
      color: ROUTE_COLOR[r.status],
    }));

  return (
    <div className="max-w-4xl mx-auto py-10 px-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-forest">Shipments</h1>
        <p className="text-xs text-black/40 mt-1">
          Click a shipment to show its route from {ORIGIN.label}. Grey: booked, amber: in transit, green: delivered.
        </p>
      </div>

      <DepotMap routes={routes} />

      <div className="flex flex-col gap-2">
        {rows.map(r => {
          const km = r.depot ? Math.round(haversineKm(ORIGIN.lat, ORIGIN.lng, r.depot.lat, r.depot.lng)) : null;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={`rounded-2xl bg-white/80 border px-5 py-4 flex items-center justify-between gap-4 text-left cursor-pointer transition-colors ${
                r.id === activeId ? "border-forest ring-1 ring-forest" : "border-black/5 hover:border-black/20"
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium text-forest truncate">{r.analysisName}</p>
                <p className="text-xs text-black/40 mt-0.5">
                  {r.depot?.name ?? "Unknown depot"} · {MODES[r.mode].label}
                  {km !== null && ` · ${km} km · ~${co2Kg(r.mode, km).toLocaleString()} kg CO₂`}
                </p>
              </div>
              <Chip color={STATUS_COLOR[r.status]} variant="soft">
                {STATUS_LABEL[r.status]}
              </Chip>
            </button>
          );
        })}
        {rows.length === 0 && (
          <p className="text-black/40 text-sm py-8 text-center">
            No shipments yet. Book transport from a finished analysis.
          </p>
        )}
      </div>
    </div>
  );
}
