"use client";
import { useEffect, useState } from "react";
import { Card, Chip } from "@heroui/react";
import type { FacilityMatchResult } from "@/lib/hp-classification/facility-match";

const FACILITY_LABELS: Record<string, string> = {
  stoleheia: "Støleheia avfallsanlegg (deponi)",
  returkraft: "Returkraft AS (forbrenningsanlegg)",
};

function eligibilityChipColor(eligible: FacilityMatchResult["eligible"]): "success" | "warning" | "danger" {
  if (eligible === true) return "success";
  if (eligible === "likely") return "warning";
  if (eligible === false) return "danger";
  return "warning";
}

function eligibilityLabel(eligible: FacilityMatchResult["eligible"]): string {
  if (eligible === true) return "Eligible";
  if (eligible === false) return "Not eligible";
  return eligible;
}

function FacilityCard({ result }: { result: FacilityMatchResult }) {
  return (
    <Card>
      <Card.Content className="flex flex-col gap-2 py-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-forest">{FACILITY_LABELS[result.facilityId] ?? result.facilityId}</p>
          <Chip color={eligibilityChipColor(result.eligible)} variant="soft">
            {eligibilityLabel(result.eligible)}
          </Chip>
        </div>
        <p className="text-xs text-black/50">{result.route}</p>
        {result.reason && <p className="text-sm text-black/70">{result.reason}</p>}
        {result.caveat && <p className="text-xs text-amber-700">{result.caveat}</p>}
      </Card.Content>
    </Card>
  );
}

export function FacilityMatchStep({ isHazardous, ealCode, matrixType }: {
  isHazardous: boolean;
  ealCode: string | null;
  matrixType: string | null;
}) {
  const [result, setResult] = useState<{ stoleheia: FacilityMatchResult; returkraft: FacilityMatchResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ealCode) {
      setLoading(false);
      setError(null);
      setResult(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/facility-match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isHazardous, ealCode, matrixType }),
    })
      .then(async res => {
        let body: { error?: string } & Record<string, unknown>;
        try {
          body = await res.json();
        } catch {
          if (!cancelled) setError(`Server error (status ${res.status})`);
          return;
        }
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error ?? "Facility matching failed");
          return;
        }
        setResult(body as unknown as { stoleheia: FacilityMatchResult; returkraft: FacilityMatchResult });
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the facility matching service.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isHazardous, ealCode, matrixType]);

  if (!ealCode) {
    return (
      <p className="text-sm text-black/70">
        Facility matching requires an assigned EAL code. This sample doesn&apos;t have one yet, so eligibility can&apos;t
        be checked.
      </p>
    );
  }
  if (loading) return <p className="text-sm">Checking facility eligibility…</p>;
  if (error) return <p className="text-danger text-sm">{error}</p>;
  if (!result) return null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-black/60">
        Matched against the two currently supported real facility permits. Eligibility states other than a plain
        Eligible/Not eligible reflect genuine gaps in available data — not a system error.
      </p>
      <FacilityCard result={result.stoleheia} />
      <FacilityCard result={result.returkraft} />
    </div>
  );
}
