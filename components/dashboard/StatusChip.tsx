"use client";
import { Chip } from "@heroui/react";

// ponytail: cases are created from an already-finished lab report, so they are always complete
export function StatusChip() {
  return <Chip color="success" variant="soft">Complete</Chip>;
}
