import type { BkField } from "./form-map";
import type { AnalysedSample } from "./analyse-bundle";
import { BK_MAPPING_VERSION, BK_QUESTIONS, type BkAnswers, type BkQuestion } from "./questions";
import { effectiveEal, readEalAssignment, type EalAssignment } from "../hp-classification/eal";

export type DecisionStatus = "complete" | "derived" | "needs_input" | "cannot_determine" | "not_applicable";
export type EvidenceSource = "document" | "classification" | "human" | "project/context" | "receiver" | "none";
export type BkDecision = { id: string; title: string; controls: string[]; status: DecisionStatus; source: EvidenceSource; reason: string; questionId?: string };
export type BkContext = { projectId: string; projectName: string; pickupLocation: string; streamId: string; originProcess: string | null };
export type BkWorkspace = { modelVersion: 1; mappingVersion?: string; state: "draft" | "ready"; fields: BkField[]; decisions: BkDecision[]; answers: BkAnswers; context: BkContext; ealDecision: EalAssignment;
  summary: { ready: number; needsInput: number; cannotDetermine: number; receiver: number } };
const filled = (f?: BkField) => Boolean(f && (f.value?.trim() || f.check || f.select));
const groupAnswered = (q: BkQuestion, fields: BkField[]) => q.kind === "choice" || q.kind === "multi_choice" ? fields.some(filled) : fields.every(filled);

/** A pure projection: neither the extraction Assessment nor previous draft revisions change.
 * The classification engine is not rerun and human input cannot override its decisions. */
export function buildBkWorkspace(sample: Pick<AnalysedSample, "fields" | "metadata" | "classification">, context: BkContext, answers: BkAnswers = {}, reviewedEal?: EalAssignment): BkWorkspace {
  const fields: BkField[] = structuredClone(sample.fields);
  const byName = new Map(fields.map(f => [f.field, f]));
  const ealDecision=readEalAssignment(reviewedEal??sample.classification.eal);
  const effective=effectiveEal({decisions:[ealDecision]});
  const ealDigits=(effective.code??"").replace(/\D/g,"");
  for(let index=0;index<6;index++){
    const field=byName.get(`TextField${17+index}`);
    if(!field)continue;
    field.value=ealDigits[index];
    field.note=effective.code?`Selected ${effective.status.replace("_"," ")}`:`EAL unresolved: ${ealDecision.reason}`;
  }
  const descriptionField=byName.get("TextField38");
  if(descriptionField?.value&&/^E\./m.test(descriptionField.value)) descriptionField.value=descriptionField.value.replace(/^E\..*$/m,effective.code?`E. EAL: valgt kode ${effective.code} (${effective.status==="reviewed"?"menneskelig gjennomgått":"maskinelt løst"}).`:`E. EAL: ikke endelig valgt. ${ealDecision.reasonNo}`);
  const decisions: BkDecision[] = [];
  // The legacy mapper's commercial assumptions are not evidence. Ask once, consistently
  // filling both delivery and recurrence controls through the logical answer.
  for (const name of ["group1", "group6"]) { const f = byName.get(name); if (f) delete f.select; }
  const contextFields = new Set<string>();
  const pickup = byName.get("TextField4");
  if (pickup && !filled(pickup) && context.pickupLocation.trim()) {
    pickup.value = context.pickupLocation; pickup.citations = []; pickup.note = `From project ${context.projectName}`;
    contextFields.add(pickup.field);
  }
  // This exact existing origin hint maps unambiguously to the printed excavation option.
  // Concrete/demolition and other broad hints are intentionally not guessed to mean new build.
  if (!answers.origin && context.originProcess === "escavo terre e rocce") {
    const f = byName.get("Checkbox11"); if (f) { f.check = true; f.note = "From the waste stream's saved origin/process"; contextFields.add(f.field); }
  }
  // Only exact physical-state words map automatically; generic 'solid' is not one of these
  // six printed options, and is not evidence for homogeneity.
  const physical = sample.metadata.physicalState?.trim().toLowerCase();
  const physicalIndex = physical === "powder" || physical === "pulver" ? 27 : physical === "liquid" || physical === "flytende" ? 28 : null;
  if (physicalIndex && !answers.physical) {
    const f = byName.get(`Checkbox${physicalIndex}`);
    if (f) { f.check = true; f.src = "extracted"; f.note = `Physical state recorded in the analysis: ${sample.metadata.physicalState}`; }
  }
  // Empty matrix is not evidence for 'Other', even if the legacy mapper ticked its fallback.
  if (!sample.metadata.matrixType?.trim() && !answers.material) for (const name of BK_QUESTIONS.find(q => q.id === "material")!.controls) { const f = byName.get(name); if (f) f.check = false; }
  const recurring = Boolean(answers.delivery && answers.delivery.value !== "single");
  const supplements: string[] = [];
  const pdfTitles: Record<string,string> = {delivery:"Leveransetype",origin:"Avfallets opprinnelse",material:"Avfallstype",physical:"Fysiske egenskaper",pretreatment:"Forbehandling",toc:"TOC","loss-on-ignition":"Glødetap",eal:"EAL-kode",hazard:"Farestatus",substances:"Påviste farlige stoffer","soil-class":"Tilstandsklasse",prohibitions:"Kontroll av forbudt avfall",precautions:"Forholdsregler"};
  for (const question of BK_QUESTIONS) {
    const members = question.controls.map(name => byName.get(name)).filter((f): f is BkField => Boolean(f));
    if (members.length === 0) continue;
    const answer = answers[question.id];
    const inactive = question.recurring && !recurring;
    if (inactive) for (const f of members) { delete f.value; f.src = "n/a"; }
    if (answer && !inactive && question.kind !== "measurement" && question.kind !== "receiver") {
      if (question.kind === "choice") {
        const selected = question.options!.find(o => o.value === answer.value);
        if (selected) for (const f of members) {
          delete f.value; delete f.select;
          if (f.field.startsWith("group")) f.select = selected.exports?.[f.field];
          else f.check = selected.controls.includes(f.field);
          f.src = "human"; f.citations = []; f.note = "Supplied in this BK draft";
        }
        if (answer.detail) supplements.push(`${pdfTitles[question.id] ?? question.title}: ${answer.detail}`);
      } else if (question.kind === "multi_choice") {
        const selected = new Set(answer.selected ?? (answer.value ? [answer.value] : []));
        for (const f of members) {
          const option = question.options!.find(item => item.controls.includes(f.field));
          f.check = Boolean(option && selected.has(option.value));
          f.src = "human"; f.citations = []; f.note = "Supplied in this BK draft";
        }
        if (answer.detail) supplements.push(`${pdfTitles[question.id] ?? question.title}: ${answer.detail}`);
      } else {
        for (const part of question.parts!) for (const [index, name] of part.controls.entries()) {
          const f = byName.get(name); if (!f) continue;
          const value = answer.values?.[part.key] ?? "";
          // Do not relabel unedited document-backed parts as human evidence.
          const next = part.controls.length > 1 ? value[index] ?? "" : value;
          if (next !== (f.value ?? "")) { f.src = "human"; f.citations = []; f.note = "Supplied in this BK draft"; }
          f.value = next;
        }
      }
    }
    let status: DecisionStatus;
    let source: EvidenceSource;
    if (question.kind === "receiver") { status = "not_applicable"; source = "receiver"; }
    else if (inactive) { status = "not_applicable"; source = "none"; }
    else if (answer) { status = "complete"; source = "human"; }
    else if (groupAnswered(question, members)) { status = "complete"; source = members.some(f => contextFields.has(f.field)) ? "project/context" : "document"; }
    else { status = question.kind === "measurement" ? "cannot_determine" : "needs_input"; source = "none"; }
    decisions.push({ id: question.id, title: question.title, controls: question.controls, status, source, questionId: question.id,
      reason: source === "project/context" ? "Provided by the saved project / waste stream context; not extracted from the PDF." : source === "document" ? "Already supplied by the analysis document." : inactive ? "Only applies when waste arises regularly." : question.why });
  }
  const hazard = sample.classification.hazard;
  const landfillAcceptance=sample.classification.landfillAcceptance??{status:"not_evaluated" as const,reason:"Landfill acceptance has not been evaluated.",evidenceMeasurementIds:[]};
  const derived: { id: string; title: string; controls: string[]; unknown?: boolean; na?: boolean; reason?: string }[] = [
    { id: "eal", title: "EAL decision", controls: [17,18,19,20,21,22].map(n => `TextField${n}`), unknown: ealDecision.resolutionStatus!=="resolved"||!ealDecision.selectedCode, reason: ealDecision.reason },
    { id: "landfill-acceptance", title: "Landfill acceptance category", controls: [1,2,3].map(n => `Checkbox${n}`), unknown: landfillAcceptance.status!=="resolved", reason: landfillAcceptance.reason },
    { id: "hazard", title: "Hazardous status and classification category", controls: [4,5,6].map(n => `Checkbox${n}`), unknown: hazard.isHazardous === null, reason: hazard.isHazardous === null ? hazard.confidenceFlags.join(" ") : "Classification snapshot from the analytical results. Inert status is not inferred from total-content analysis." },
    { id: "testing", title: "Landfill testing obligation", controls: ["Checkbox7", "Checkbox8"], unknown: true, reason: "The existence of an analysis report does not establish the applicable landfill testing obligation." },
    { id: "substances", title: "Detected hazardous substances", controls: ["Checkbox9", "Checkbox10"], unknown: hazard.hasDetectedHazardousSubstance === null },
    { id: "leaching", title: "Leaching and column tests", controls: ["group2", "group3"], reason: "Recorded pipeline result. See original report and classification evidence for scope and limitations." },
    { id: "soil-class", title: "Soil / sediment condition class", controls: ["TextField37"], unknown: /jord|soil|sediment/i.test(sample.metadata.matrixType ?? "") && !filled(byName.get("TextField37")), na: !/jord|soil|sediment/i.test(sample.metadata.matrixType ?? "") },
    { id: "prohibitions", title: "Prohibited-waste checks", controls: [41,42,43,44,45,46].map(n => `Checkbox${n}`), unknown: true, reason: "Unticked controls do not prove the absence of prohibited properties. The saved pipeline does not establish all of these checks." },
    { id: "precautions", title: "Handling precautions", controls: ["TextField41"], unknown: true, reason: "Acceptance criteria and receiver precautions require a separate review." },
  ];
  for (const decision of derived) decisions.push({ ...decision, status: decision.na ? "not_applicable" : decision.unknown ? "cannot_determine" : "derived", source: "classification", reason: decision.reason || "Derived by the existing classification and BK mapping. Inspect the saved reasoning and applicable legal evidence." });
  const summary = { ready: decisions.filter(d => d.status === "complete" || d.status === "derived").length, needsInput: decisions.filter(d => d.status === "needs_input").length, cannotDetermine: decisions.filter(d => d.status === "cannot_determine").length, receiver: decisions.filter(d => d.source === "receiver").length };
  const description = byName.get("TextField38");
  if (description) description.value = [description.value, ...supplements.map(s => `Brukeropplysning: ${s}`), summary.cannotDetermine ? `Uavklart i BK-vurderingen: ${decisions.filter(d => d.status === "cannot_determine").map(d => pdfTitles[d.id] ?? d.title).join("; ")}. Dette er ikke en godkjenning for deponering.` : ""].filter(Boolean).join("\n");
  return { modelVersion: 1, mappingVersion: BK_MAPPING_VERSION, state: summary.needsInput ? "draft" : "ready", fields, decisions, answers: structuredClone(answers), context: structuredClone(context), ealDecision, summary };
}

export function decisionForField(workspace: BkWorkspace, field: string) { return workspace.decisions.find(d => d.controls.includes(field)); }
export function questionValues(question: BkQuestion, fields: BkField[]): Record<string, string> {
  return Object.fromEntries((question.parts ?? []).map(part => [part.key, part.controls.map(name => fields.find(f => f.field === name)?.value ?? "").join("")]));
}

/** A question may be partly answered: completed document controls stay green even when
 * another control in that logical question still needs a person. */
export function fieldAttention(workspace: BkWorkspace) {
  return Object.fromEntries(workspace.decisions.flatMap(decision => decision.controls.map(control => {
    const field = workspace.fields.find(f => f.field === control);
    const complete = decision.status === "needs_input" && field?.src === "extracted" && filled(field);
    return [control, { status: complete ? "complete" as const : decision.status, label: complete ? field!.label : decision.title }];
  })));
}

/** Expose the existing stable citation keys at their logical decision, even when the
 * original mapper attached the citation to a different raw outcome control. */
export function legalFieldsForDecision(workspace: BkWorkspace, decision?: BkDecision): BkField[] {
  if (!decision) return [];
  const keys: Record<string,string[]> = { eal:["eal-legal-basis"], "landfill-acceptance":["deponi-category-basis"], testing:["deponi-category-basis"], hazard:["hp-methodology-basis","hazard-indeterminate-basis"], description:["hp-methodology-basis"], precautions:["deponi-category-basis"] };
  return workspace.fields.filter(field => (decision.controls.includes(field.field) || (keys[decision.id] ?? []).includes(field.legalCitationKey ?? "")) && field.legalCitation?.citations.length && field.legalCitationKey)
    .filter((field,index,all) => all.findIndex(other => other.legalCitationKey === field.legalCitationKey) === index);
}
