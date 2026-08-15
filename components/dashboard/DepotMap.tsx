"use client";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { DEPOTS, depotIsLit, type Depot } from "@/lib/depots";

export interface MapRoute {
  from: [number, number]; // [lat, lng]
  to: [number, number];
  label: string;
  color: string;
}

// default export so the page can next/dynamic() it — Leaflet cannot render on the server
export default function DepotMap({
  isHazardous,
  avfallsstoffnr,
  onRequestTransport,
  routes = [],
}: {
  isHazardous?: boolean;
  avfallsstoffnr?: string | null;
  onRequestTransport?: (depot: Depot) => void;
  routes?: MapRoute[];
}) {
  return (
    <MapContainer
      center={[64.5, 13]}
      zoom={4}
      scrollWheelZoom
      className="h-96 w-full rounded-2xl z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />
      {routes.map(r => (
        <Polyline
          key={r.label}
          positions={[r.from, r.to]}
          pathOptions={{ color: r.color, weight: 3, dashArray: "6 8" }}
        >
          <Popup>{r.label}</Popup>
        </Polyline>
      ))}
      {DEPOTS.map(d => {
        const lit = isHazardous !== undefined && depotIsLit(d, isHazardous, avfallsstoffnr);
        return (
          <CircleMarker
            key={d.id}
            center={[d.lat, d.lng]}
            radius={lit ? 10 : 6}
            pathOptions={{
              color: lit ? "#65a30d" : "#94a3b8",
              fillColor: lit ? "#65a30d" : "#94a3b8",
              fillOpacity: lit ? 0.85 : 0.25,
              weight: lit ? 2 : 1,
              className: lit ? "depot-glow-lime" : undefined,
            }}
          >
            <Popup>
              <p className="font-semibold">{d.name}</p>
              <p className="text-xs">{d.kommune}, {d.fylke}</p>
              <p className="text-xs mt-1">
                {d.codes.length > 0
                  ? `Permitted codes: ${d.codes.slice(0, 8).join(", ")}${d.codes.length > 8 ? ` +${d.codes.length - 8} more` : ""}`
                  : "Permitted codes not yet extracted from permit"}
              </p>
              <p className="text-xs mt-1">
                <a href={d.permitUrl} target="_blank" rel="noreferrer">View permit (PDF)</a>
              </p>
              {isHazardous !== undefined && (
                <p className="text-xs mt-1">
                  {lit
                    ? avfallsstoffnr
                      ? `✓ Permit covers avfallsstoffnr ${avfallsstoffnr}`
                      : "✓ Licensed to receive hazardous waste"
                    : isHazardous
                      ? avfallsstoffnr
                        ? `Permit does not list avfallsstoffnr ${avfallsstoffnr}`
                        : "Not licensed for this waste"
                      : "Ordinary waste — use municipal facilities"}
                </p>
              )}
              {lit && onRequestTransport && (
                <button
                  onClick={() => onRequestTransport(d)}
                  className="mt-2 rounded-lg bg-forest text-lime px-3 py-1.5 text-xs font-medium cursor-pointer"
                >
                  Request transport
                </button>
              )}
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
