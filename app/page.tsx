"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { StatCard } from "@/components/dashboard/DashboardCards";
import { listProjects, listCasesForProject, type Project } from "@/lib/projects";

interface ProjectRow {
  project: Project;
  caseCount: number;
  hazardousEntryCount: number;
}

export default function ProjectsPage() {
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const projects = listProjects();
    setRows(
      projects.map(project => {
        const cases = listCasesForProject(project.id);
        const entries = cases.flatMap(c => c.wasteEntries);
        return { project, caseCount: cases.length, hazardousEntryCount: entries.filter(e => e.isHazardous).length };
      })
    );
    setNow(Date.now());
  }, []);

  if (!now) return null; // avoid SSR/client mismatch: localStorage only exists client-side

  const totalCases = rows.reduce((sum, r) => sum + r.caseCount, 0);
  const totalHazardous = rows.reduce((sum, r) => sum + r.hazardousEntryCount, 0);

  return (
    <div className="max-w-4xl mx-auto py-10 px-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-forest">My projects</h1>
        <Link
          href="/order"
          className="rounded-xl bg-forest text-lime px-4 py-2 text-sm font-medium hover:bg-forest-light transition-colors"
        >
          Order analysis
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Projects" value={String(rows.length)} />
        <StatCard label="Cases" value={String(totalCases)} />
        <StatCard label="Hazardous entries" value={String(totalHazardous)} />
      </div>

      <div className="flex flex-col gap-2">
        {rows.map(({ project, caseCount, hazardousEntryCount }) => (
          <Link
            key={project.id}
            href={`/projects/${project.id}`}
            className="rounded-2xl bg-white/80 border border-black/5 px-5 py-4 flex items-center justify-between gap-4 hover:border-forest/30 transition-colors"
          >
            <div className="min-w-0">
              <p className="font-medium text-forest truncate">{project.name}</p>
              <p className="text-xs text-black/40 mt-0.5">
                {project.location} · {caseCount} case{caseCount === 1 ? "" : "s"}
                {hazardousEntryCount > 0 && ` · ${hazardousEntryCount} hazardous`}
              </p>
            </div>
          </Link>
        ))}
        {rows.length === 0 && <p className="text-black/40 text-sm py-8 text-center">No projects yet.</p>}
      </div>
    </div>
  );
}
