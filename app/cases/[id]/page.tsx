"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Chip, Button } from "@heroui/react";
import { StatusChip } from "@/components/dashboard/StatusChip";
import { getCase, computeStatus, type Case, type WasteEntry } from "@/lib/projects";
import { getReportFile } from "@/lib/wizard/report-storage";
import type { Depot } from "@/lib/depots";
import { ORIGIN, MODES, ASSUMED_LOAD_TONNES, haversineKm, co2Kg, addShipment, type TransportMode } from "@/lib/shipments";
import { useRouter } from "next/navigation";

const DepotMap = dynamic(() => import("@/components/dashboard/DepotMap"), { ssr: false });

function WasteEntryCard({ caseName, entry }: { caseName: string; entry: WasteEntry }) {
  const router = useRouter();
  const [transportDepot, setTransportDepot] = useState<Depot | null>(null);
  const [mode, setMode] = useState<TransportMode>("truck");

  return (
    <div className="rounded-2xl bg-white/80 border border-black/5 px-6 py-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="font-medium text-forest">{entry.sampleLabel}</p>
        <Chip color={entry.isHazardous ? "danger" : "success"} variant="soft">
          {entry.isHazardous ? "Hazardous" : "Non-hazardous"}
        </Chip>
        {entry.ealCode && <span className="text-sm font-mono text-forest">EAL {entry.ealCode}</span>}
      </div>
      <p className="text-sm text-black/70">{entry.summary}</p>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-forest">Eligible depot stations</h3>
        <p className="text-xs text-black/40">
          Norwegian farlig avfall receivers (avfallsdeklarering.no / norskeutslipp.no permits).{" "}
          {entry.isHazardous
            ? entry.avfallsstoffnr
              ? `Glowing stations hold a permit covering avfallsstoffnr ${entry.avfallsstoffnr} — zoom and click one for its permitted codes and permit PDF.`
              : "Glowing stations are licensed to receive hazardous waste — zoom and click one for its permitted codes and permit PDF."
            : "This waste is non-hazardous and can go to ordinary municipal facilities; hazardous receivers are shown dimmed."}
        </p>
        <DepotMap
          isHazardous={entry.isHazardous}
          avfallsstoffnr={entry.avfallsstoffnr}
          onRequestTransport={setTransportDepot}
        />
      </div>

      {transportDepot && (
        <div className="rounded-xl border border-black/5 bg-cream/50 px-4 py-4 flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold text-forest">Transport to {transportDepot.name}</h3>
            <p className="text-xs text-black/40 mt-0.5">
              {ORIGIN.label} → {transportDepot.name} ·{" "}
              {Math.round(haversineKm(ORIGIN.lat, ORIGIN.lng, transportDepot.lat, transportDepot.lng))} km ·{" "}
              assumed load {ASSUMED_LOAD_TONNES} t
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.keys(MODES) as TransportMode[]).map(m => {
              const km = haversineKm(ORIGIN.lat, ORIGIN.lng, transportDepot.lat, transportDepot.lng);
              const active = m === mode;
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                    active ? "border-forest bg-forest text-cream" : "border-black/10 bg-white hover:border-forest/40"
                  }`}
                >
                  <p className={`text-sm font-medium ${active ? "text-lime" : "text-forest"}`}>{MODES[m].label}</p>
                  <p className={`text-xs mt-0.5 ${active ? "text-cream/70" : "text-black/40"}`}>
                    ~{co2Kg(m, km).toLocaleString()} kg CO₂
                  </p>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={() => setTransportDepot(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onPress={() => {
                addShipment({ analysisName: `${caseName} — ${entry.sampleLabel}`, depotId: transportDepot.id, mode });
                router.push("/shipments");
              }}
            >
              Book transport
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReportLink({ caseId, fileName }: { caseId: string; fileName: string }) {
  const [notFound, setNotFound] = useState(false);

  async function handleView() {
    const file = await getReportFile(caseId);
    if (!file) {
      setNotFound(true);
      return;
    }
    const url = URL.createObjectURL(file);
    window.open(url, "_blank");
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-black/50">Original report: {fileName}</span>
      <Button variant="secondary" onPress={handleView}>View</Button>
      {notFound && <span className="text-xs text-danger">Report file not available.</span>}
    </div>
  );
}

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [caseData, setCaseData] = useState<Case | null | undefined>(undefined);
  const [now, setNow] = useState(0);

  useEffect(() => {
    setCaseData(getCase(id) ?? null);
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tick);
  }, [id]);

  if (caseData === undefined || !now) return null;
  if (caseData === null) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-6">
        <p className="text-black/50">Case not found.</p>
        <Link href="/" className="text-forest underline text-sm">Back to my projects</Link>
      </div>
    );
  }

  const status = computeStatus(caseData.createdAt, now);

  return (
    <div className="max-w-3xl mx-auto py-10 px-6 flex flex-col gap-6">
      <div>
        <Link href={`/projects/${caseData.projectId}`} className="text-sm text-black/40 hover:text-forest">&larr; Back to project</Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-forest">{caseData.name}</h1>
          <StatusChip status={status} />
        </div>
        <p className="text-xs text-black/40 mt-1">Sent {new Date(caseData.createdAt).toLocaleString()}</p>
      </div>

      {caseData.reportFileName && <ReportLink caseId={caseData.id} fileName={caseData.reportFileName} />}

      {status !== "complete" && (
        <p className="text-sm text-black/50">
          The lab is processing this case. Results appear here automatically when it completes.
        </p>
      )}

      {status === "complete" &&
        caseData.wasteEntries.map(entry => <WasteEntryCard key={entry.id} caseName={caseData.name} entry={entry} />)}

      {status === "complete" && caseData.wasteEntries.length === 0 && (
        <p className="text-sm text-black/50">Case complete — no waste entries attached.</p>
      )}
    </div>
  );
}
