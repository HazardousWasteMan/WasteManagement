"use client";
import dynamic from "next/dynamic";

const DepotMap = dynamic(() => import("@/components/dashboard/DepotMap"), { ssr: false });

export function FacilityMatchStep({ isHazardous }: { isHazardous: boolean | null }) {
  return (
    <div>
      <p className="mb-2 text-sm text-black/60">
        {isHazardous === null
          ? "Hazard status could not be determined — resolve manually before matching a facility. No receivers are highlighted below."
          : isHazardous
            ? "Licensed hazardous-waste receivers are highlighted on the map."
            : "Non-hazardous waste can go to ordinary municipal facilities; hazardous receivers are shown dimmed."}
      </p>
      {/* ponytail: avfallsstoffnr not known in the wizard yet (EAL→avfallsstoffnr table missing), so all hazardous receivers light up */}
      <DepotMap isHazardous={isHazardous} />
    </div>
  );
}
