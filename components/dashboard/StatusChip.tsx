"use client";
import { Chip } from "@heroui/react";
import type { CaseStatus } from "@/lib/projects";

const LABEL: Record<CaseStatus, string> = {
  sent: "Sent",
  in_progress: "In progress",
  complete: "Complete",
};

export function StatusChip({ status }: { status: CaseStatus }) {
  return (
    <Chip color={status === "complete" ? "success" : status === "in_progress" ? "warning" : "default"} variant="soft">
      {LABEL[status]}
    </Chip>
  );
}
