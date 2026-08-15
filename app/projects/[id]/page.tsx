"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getProject, listCasesForProject, computeStatus, updateProject, type Project, type Case } from "@/lib/projects";
import { StatusChip } from "@/components/dashboard/StatusChip";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [cases, setCases] = useState<Case[]>([]);
  const [now, setNow] = useState(0);
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState("");

  useEffect(() => {
    setProject(getProject(id) ?? null);
    setCases(listCasesForProject(id));
    setNow(Date.now());
  }, [id]);

  function handleEditLocation() {
    if (!project) return;
    setLocationDraft(project.location);
    setIsEditingLocation(true);
  }

  function handleSaveLocation() {
    if (!project) return;
    const updated = updateProject(project.id, { location: locationDraft.trim() });
    setProject(updated);
    setIsEditingLocation(false);
  }

  function handleCancelEditLocation() {
    setIsEditingLocation(false);
  }

  if (project === undefined || !now) return null;
  if (project === null) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-6">
        <p className="text-black/50">Project not found.</p>
        <Link href="/" className="text-forest underline text-sm">Back to my projects</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-6 flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-black/40 hover:text-forest">&larr; My projects</Link>
        <h1 className="text-2xl font-semibold text-forest mt-2">{project.name}</h1>
        {isEditingLocation ? (
          <div className="flex flex-col gap-2 mt-2">
            <input
              type="text"
              value={locationDraft}
              onChange={e => setLocationDraft(e.target.value)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSaveLocation}
                className="text-xs font-medium rounded-lg px-3 py-1 bg-forest text-cream hover:bg-forest-light"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleCancelEditLocation}
                className="text-xs font-medium rounded-lg px-3 py-1 border border-black/10 text-black/60 hover:bg-black/5"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-black/50">{project.location}</p>
            <button
              type="button"
              onClick={handleEditLocation}
              className="text-xs text-forest underline"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {cases.map(c => {
          const status = computeStatus(c.createdAt, now);
          const hazardousCount = c.wasteEntries.filter(e => e.isHazardous).length;
          return (
            <Link
              key={c.id}
              href={`/cases/${c.id}`}
              className="rounded-2xl bg-white/80 border border-black/5 px-5 py-4 flex items-center justify-between gap-4 hover:border-forest/30 transition-colors"
            >
              <div className="min-w-0">
                <p className="font-medium text-forest truncate">{c.name}</p>
                <p className="text-xs text-black/40 mt-0.5">
                  Sent {new Date(c.createdAt).toLocaleString()} · {c.wasteEntries.length} waste entr{c.wasteEntries.length === 1 ? "y" : "ies"}
                  {hazardousCount > 0 && ` · ${hazardousCount} hazardous`}
                </p>
              </div>
              <StatusChip status={status} />
            </Link>
          );
        })}
        {cases.length === 0 && <p className="text-black/40 text-sm py-8 text-center">No cases yet for this project.</p>}
      </div>
    </div>
  );
}
