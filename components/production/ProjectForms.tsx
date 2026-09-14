"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ORIGIN_OPTIONS } from "@/lib/hp-classification/origin-options";
import { ProductionDialog } from "./ProductionDialog";

const inputStyle = "block w-full rounded-xl border border-forest/20 bg-white p-2 mt-1";
const buttonStyle = "rounded-xl bg-forest px-4 py-2 text-cream disabled:opacity-50";
async function result(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}
export function CreateProjectForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="space-y-3 max-w-lg" onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const body = await result(await fetch("/api/production/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), location: form.get("location") }) }));
      router.push(`/production/projects/${body.project.id}`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not create project"); }
    finally { setBusy(false); }
  }}>
    <label className="block">Project name<input className={inputStyle} name="name" required maxLength={200} /></label>
    <label className="block">Location (optional)<input className={inputStyle} name="location" maxLength={500} /></label>
    <button className={buttonStyle} disabled={busy}>{busy ? "Creating…" : "Create project"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
export function CreateProjectDialog() {
  return <ProductionDialog trigger="+ New project" title="Create a project" description="Set up a long-lived job or site. Analyses and waste streams can be added after creation."><CreateProjectForm /></ProductionDialog>;
}
export function AnalysisUploadDialog({projectId}:{projectId:string}) {
  return <ProductionDialog trigger="+ Add analysis" title="Add an analysis report" description="Upload a PDF and optionally describe the waste origin or process. Each identified sample is preserved as its own assessment."><DocumentForm projectId={projectId}/></ProductionDialog>;
}

/** Refresh server-rendered per-sample commits while an attempt holds its bounded lease. */
export function ProcessingRefresh({ until }: { until: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => { router.refresh(); if (Date.now() > until) clearInterval(timer); }, 3000);
    return () => clearInterval(timer);
  }, [router, until]);
  return null;
}

export function DocumentForm({ projectId, documentId, initialOrigin, disabled = false }: { projectId: string; documentId?: string; initialOrigin?: string | null; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Retain the attempt key after an ambiguous network failure. Explicit reprocessing after
  // a confirmed response gets a new key; ordinary submit retries cannot create duplicates.
  const attempt = useRef<string | null>(null);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [busy, router]);
  return <form className="space-y-3" onChange={() => { attempt.current = null; }} onSubmit={async event => {
    event.preventDefault(); if (busy) return;
    const form = new FormData(event.currentTarget);
    attempt.current ??= crypto.randomUUID();
    form.set("runId", attempt.current);
    setBusy(true); setMessage("");
    try {
      const url = `/api/production/projects/${projectId}/documents${documentId ? `/${documentId}/process` : ""}`;
      const response = await fetch(url, documentId ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: attempt.current, originProcess: form.get("originProcess") }) } : { method: "POST", body: form });
      const body = await result(response);
      attempt.current = null;
      setMessage(`Processing ${body.run.status}. Saved results are shown below.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Connection interrupted. Refresh to check saved results; retrying this form reuses the same attempt."); }
    finally { setBusy(false); router.refresh(); }
  }}>
    <fieldset disabled={busy || disabled} className="space-y-3">
      {!documentId && <label className="block">Analysis PDF (up to 25 MB)<input className={inputStyle} type="file" name="file" accept="application/pdf,.pdf" required /></label>}
      <label className="block">Origin/process (optional)<select name="originProcess" defaultValue={initialOrigin ?? ""} className={inputStyle}>
        <option value="">Not specified</option>{ORIGIN_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      <button className={buttonStyle} disabled={busy || disabled}>{busy ? "Processing…" : documentId ? "Reprocess document" : "Upload and analyse"}</button>
    </fieldset>
    <p className="text-xs text-forest/70">Each new analysis creates new waste streams and assessments. Identical PDFs reuse the saved document; earlier results remain unchanged.</p>
    <p role="status" className="text-sm">{message || (busy ? "Saving each sample as it completes. This may take several minutes." : "")}</p>
  </form>;
}
