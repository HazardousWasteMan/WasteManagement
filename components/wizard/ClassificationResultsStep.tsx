"use client";
import { Card, Chip, Button } from "@heroui/react";
import { HeroCard, StatCard } from "@/components/dashboard/DashboardCards";

type HpOutcome = boolean | "not tested — assumed not applicable" | "requires case-specific assessment — not automatable from lab data alone" | "superseded by HP8";

interface HazardClassification {
  resultsByHp: Record<string, HpOutcome>;
  triggeringSubstancesByHp: Record<string, string[]>;
  isHazardous: boolean;
  triggeredHps: string[];
  confidenceFlags: string[];
}

interface EalAssignment {
  code: string | null;
  description: string | null;
  confidence: string;
}

function outcomeLabel(outcome: HpOutcome): string {
  if (outcome === true) return "Triggered";
  if (outcome === false) return "Not triggered";
  return outcome;
}

export function ClassificationResultsStep({ hazard, eal, noDataWarning, onContinue }: {
  hazard: HazardClassification;
  eal: EalAssignment;
  noDataWarning?: boolean;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {noDataWarning && (
        <Card className="border-2 border-danger">
          <Card.Content className="py-4">
            <p className="text-sm font-bold text-danger">No analyte data available</p>
            <p className="text-sm text-danger/90 mt-1">
              No analyte results were available to classify — this result reflects a lack of data, not a confirmed
              non-hazardous finding. Do not rely on this classification.
            </p>
          </Card.Content>
        </Card>
      )}

      <HeroCard
        label="EAL Code"
        value={eal.code ?? "Not determined"}
        sublabel={eal.description ?? eal.confidence}
      />

      <StatCard label="Confidence" value={eal.confidence} valueClassName="text-sm break-words" />

      <StatCard label="Hazardous waste" value={hazard.isHazardous ? "Yes" : "No"} />

      <Card>
        <Card.Content className="flex flex-col gap-2 py-4">
          <p className="text-sm font-medium text-forest">HP1–HP15 outcomes</p>
          {Object.entries(hazard.resultsByHp)
            .sort(([a], [b]) => Number(a.slice(2)) - Number(b.slice(2)))
            .map(([hp, outcome]) => {
              const substances = hazard.triggeringSubstancesByHp[hp];
              return (
                <div key={hp} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-3 text-sm">
                    <Chip color={outcome === true ? "danger" : "default"} variant="soft" className="w-14 justify-center">
                      {hp}
                    </Chip>
                    <span className="text-black/70">{outcomeLabel(outcome)}</span>
                  </div>
                  {substances && substances.length > 0 && (
                    <p className="text-xs text-black/50 pl-[4.25rem]">Triggered by: {substances.join(", ")}</p>
                  )}
                </div>
              );
            })}
        </Card.Content>
      </Card>

      {hazard.confidenceFlags.length > 0 && (
        <Card>
          <Card.Content className="py-4">
            <p className="text-sm font-medium">Caveats</p>
            <ul className="text-xs text-black/60 mt-1 flex flex-col gap-1">
              {hazard.confidenceFlags.map((flag, i) => (
                <li key={i}>{flag}</li>
              ))}
            </ul>
          </Card.Content>
        </Card>
      )}

      <Button variant="primary" onPress={onContinue} className="self-start">
        Continue to facility match
      </Button>
    </div>
  );
}
