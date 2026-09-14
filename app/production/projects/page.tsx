import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { getProductionApplication } from "@/lib/production/server";
import { CreateProjectDialog } from "@/components/production/ProjectForms";
import { formatProductionDate } from "@/lib/production/presentation";

export default async function ProductionProjectsPage() {
  let data: { organisation: { name: string }; projects: import("@/lib/production/types").Project[] } | null = null;
  try {
    const { organisation, store } = await getProductionApplication();
    data = { organisation, projects: await store.listProjects() };
  } catch (error) { unstable_rethrow(error); }
  if (!data) return <main className="p-8 text-forest"><h1 className="text-2xl font-semibold">Production projects unavailable</h1><p>The organisation is not configured or the service is unavailable. Contact your administrator or try again.</p><Link href="/data-lab" className="underline">Open Data Lab</Link></main>;
  const { organisation, projects } = data;
  return <main className="mx-auto min-h-screen max-w-6xl space-y-8 px-5 py-8 text-forest sm:px-8 lg:py-12">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-forest/10 pb-7"><div><p className="mb-2 text-sm font-medium text-forest/55">{organisation.name}</p><h1 className="text-3xl font-semibold tracking-tight">Projects</h1><p className="mt-2 max-w-2xl text-sm text-forest/65">Manage waste streams, laboratory evidence and basiskarakterisering in one place.</p></div><CreateProjectDialog /></header>
      <section aria-labelledby="projects-heading"><h2 id="projects-heading" className="sr-only">Projects</h2>
        {projects.length ? <ul className="grid gap-4 md:grid-cols-2">{projects.map(project => <li key={project.id}><Link className="group block rounded-2xl border border-forest/10 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-forest/25 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest" href={`/production/projects/${project.id}`}><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold group-hover:underline">{project.name}</h3><p className="mt-1 text-sm text-forest/60">{project.location||"Location not added"}</p></div><span aria-hidden="true" className="text-xl text-forest/40 transition group-hover:translate-x-1">→</span></div><p className="mt-6 text-xs text-forest/45">Created {formatProductionDate(project.created_at)}</p></Link></li>)}</ul> : <div className="rounded-2xl border border-dashed border-forest/20 bg-white/60 px-6 py-14 text-center"><div className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-lime/25 text-xl" aria-hidden="true">＋</div><h2 className="text-lg font-semibold">Start with your first project</h2><p className="mx-auto mt-2 max-w-md text-sm text-forest/60">Create a project for a job or site, then add analysis reports as evidence becomes available.</p><div className="mt-5"><CreateProjectDialog /></div></div>}
      </section>
    </main>;
}
