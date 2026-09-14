export const BK_MAPPING_VERSION = "bk-evidence-separation-2026-09-10.1";
/** Logical questions verified against both pages of the actual BK template and widget map.
 * Raw controls are infrastructure; answer keys and labels are the customer-facing model. */
export type QuestionOption = { value: string; label: string; controls: string[]; exports?: Record<string, string> };
export type QuestionPart = { key: string; label: string; controls: string[]; max: number; pattern?: string };
export type BkQuestion = { id: string; title: string; why: string; controls: string[]; kind: "text" | "choice" | "multi_choice" | "measurement" | "receiver";
  parts?: QuestionPart[]; options?: QuestionOption[]; recurring?: boolean };
export type BkAnswer = { value?: string; selected?: string[]; values?: Record<string, string>; detail?: string };
export type BkAnswers = Record<string, BkAnswer>;
const text = (id: string, title: string, why: string, parts: QuestionPart[], recurring = false): BkQuestion => ({ id, title, why, parts, controls: parts.flatMap(p => p.controls), kind: "text", recurring });
const part = (key: string, label: string, controls: string[], max = 100, pattern?: string): QuestionPart => ({ key, label, controls, max, pattern });
const boxes = (start: number, labels: string[]): QuestionOption[] => labels.map((label, i) => ({ value: String(i), label, controls: [`Checkbox${start + i}`] }));
const choice = (id: string, title: string, why: string, options: QuestionOption[]): BkQuestion => ({ id, title, why, options, controls: [...new Set(options.flatMap(o => o.controls))], kind: "choice" });
const multiChoice = (id: string, title: string, why: string, options: QuestionOption[]): BkQuestion => ({ id, title, why, options, controls: [...new Set(options.flatMap(o => o.controls))], kind: "multi_choice" });
export const BK_QUESTIONS: BkQuestion[] = [
  choice("delivery", "What type of delivery is this?", "Delivery and recurrence are operational facts. The laboratory cannot decide them.", [
    { value: "single", label: "Single delivery; waste does not arise regularly", controls: ["group1", "group6"], exports: { group1: "Radio1", group6: "Radio1" } },
    { value: "first", label: "Regularly produced waste — first delivery", controls: ["group1", "group6"], exports: { group1: "Radio3", group6: "Radio2" } },
    { value: "subsequent", label: "Regularly produced waste — subsequent delivery", controls: ["group1", "group6"], exports: { group1: "Radio4", group6: "Radio2" } },
    { value: "verification", label: "Regularly produced waste — verification", controls: ["group1", "group6"], exports: { group1: "Radio5", group6: "Radio2" } },
  ]),
  text("pickup", "Where will the waste be collected?", "A pickup location is needed when neither the report nor the project supplies it.", [part("location", "Pickup location", ["TextField4"], 160)]),
  text("marking", "What is the producer's reference for this waste?", "Use the producer's waste or sample reference.", [part("reference", "Producer reference", ["TextField5"], 80)]),
  text("producer", "Who produced the waste?", "The portal customer may be a handler rather than the producer. We do not assume they are the same organisation.", [part("name", "Producer name", ["TextField6"], 100), part("number", "Organisation number", ["TextField7"], 9, "^[0-9]{9}$")]),
  text("address", "What is the producer's address?", "Provide the producer's address where it is absent from the report.", [part("street", "Address", ["TextField8"], 100), part("postal", "Postcode", ["TextField11"], 12), part("town", "Town", ["TextField14"], 80)]),
  text("contact", "Who can answer questions about this waste?", "Use the producer's contact details, not the laboratory's.", [part("name", "Contact name", ["TextField9"], 80), part("phone", "Phone", ["TextField12"], 30), part("email", "Email", ["TextField15"], 100)]),
  text("transporter", "Who is the transporter or contractor?", "Transport arrangements are not laboratory evidence.", [part("name", "Transporter / contractor", ["TextField10"], 100), part("phone", "Phone", ["TextField13"], 30), part("email", "Email", ["TextField16"], 100)]),
  text("waste-number", "What is the administrative waste number?", "Use the agreed NS 9431 material code. It is separate from the calculated EAL decision.", [part("code", "Waste number (4 digits)", ["TextField23", "TextField24", "TextField25", "TextField26"], 4, "^[0-9]{4}$")]),
  text("industry", "What is the industry code?", "An administrative code cannot be inferred from chemical analysis.", [part("code", "Industry code (3 digits)", ["TextField27", "TextField28", "TextField29"], 3, "^[0-9]{3}$")]),
  text("municipality", "What is the municipality code?", "The template provides five digit boxes. Use the applicable administrative code.", [part("code", "Municipality code (up to 5 digits)", ["TextField30", "TextField31", "TextField32", "TextField33", "TextField34"], 5, "^[0-9]{4,5}$")]),
  { id: "toc", title: "Total organic carbon (TOC)", why: "A missing laboratory measurement cannot safely be guessed. Obtain analytical evidence before relying on it.", controls: ["TextField35"], kind: "measurement" },
  { id: "loss-on-ignition", title: "Loss on ignition", why: "A missing laboratory measurement cannot safely be guessed. Obtain analytical evidence before relying on it.", controls: ["TextField36"], kind: "measurement" },
  choice("origin", "How did the waste arise?", "The material alone does not establish the process that produced the waste.", boxes(11, ["Excavation / dredging", "Construction (new building)", "Production / industry", "Household / cabin", "Trade / office", "Sorting / waste facility", "Incineration plant", "Other"])),
  choice("material", "What type of waste is this?", "The report did not identify a supported material reliably.", [...boxes(19, ["Contaminated soil / sediment", "Excavated material containing waste", "Street sweepings / grit", "Sand-trap material", "Concrete / brick", "Ash / slag", "Sewage sludge", "Screenings"]), { value: "8", label: "Mixed", controls: ["Checkbox39"] }, { value: "9", label: "Other", controls: ["Checkbox40"] }]),
  choice("physical", "What best describes the physical form?", "The laboratory report did not reliably determine the waste's physical form.", boxes(27, ["Powder", "Liquid", "Large object (monolithic)", "Heterogeneous", "Homogeneous", "Other"])),
  multiChoice("pretreatment", "Has the waste been pretreated?", "Pretreatment is an operational fact. Select every documented treatment that applies.", boxes(33, ["Sorting plant", "Biological treatment", "Incineration", "Grinding / shredding", "None", "Other pretreatment"])),
  text("colour", "What colour is the waste?", "This observation is not available in the laboratory analysis.", [part("description", "Colour / description", ["TextField39"], 160)]),
  text("smell", "How does the waste smell?", "Smell is not available in the laboratory analysis. Describe an existing observation, including no noticeable smell where appropriate.", [part("description", "Smell / description", ["TextField40"], 100)]),
  text("description", "Review the generated waste description", "The structured narrative remains editable before finalization. Preserve uncertainty and distinguish HP, EAL and landfill acceptance.", [part("text", "Waste description and evidence summary", ["TextField38"], 3500)]),
  ...["Organic", "Inorganic", "Plastic", "Other"].map((label, index) => text(`fraction-${index}`, `${label} fraction in recurring waste`, "Use measured composition and documented normal variation, not estimates without supporting records.", [part("measured", "Measured content (weight %)", [`TextField${42 + index}`], 12), part("variation", "Normal variation (from–to %)", [`TextField${46 + index}`], 20)], true)),
  text("verification-dates", "When is recurring waste verified?", "Provide the dates from the verification plan.", [part("last", "Verification date", ["TextField50"], 20), part("next", "Next verification date", ["TextField51"], 20)], true),
  text("verification-parameters", "Which parameters are verified?", "Use the parameters in the verification plan.", [part("parameters", "Verification parameters", ["TextField52"], 200)], true),
  text("recurring-documentation", "What documentation supports recurring waste?", "Identify the characterization and verification documentation accompanying the waste.", [part("description", "Supporting documentation", ["TextField53"], 350)], true),
  { id: "receiver", title: "Receiver completes this", why: "Customer number, the receiver's project reference and landfill remarks belong to the receiving facility.", controls: ["TextField1", "TextField2", "TextField3"], kind: "receiver" },
];

export class BkQuestionError extends Error {}
export function validateAnswer(questionId: string, input: unknown): BkAnswer {
  const question = BK_QUESTIONS.find(q => q.id === questionId);
  if (!question || question.kind === "measurement" || question.kind === "receiver") throw new BkQuestionError("This decision cannot be edited as a human answer.");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BkQuestionError("Provide an answer.");
  const answer = input as BkAnswer;
  if (question.kind === "choice") {
    const option = question.options!.find(o => o.value === answer.value);
    if (!option) throw new BkQuestionError("Select one of the available options.");
    if (answer.detail !== undefined && (typeof answer.detail !== "string" || answer.detail.length > 250)) throw new BkQuestionError("Keep the explanation under 250 characters.");
    const detail = answer.detail?.trim() ?? "";
    if (/other/i.test(option.label) && !detail) throw new BkQuestionError("Describe the other option.");
    return { value: option.value, detail };
  }
  if (question.kind === "multi_choice") {
    const requested = answer.selected ?? (answer.value ? [answer.value] : []);
    const selected = [...new Set(requested)];
    if (!selected.length || selected.some(value => !question.options!.some(option => option.value === value))) throw new BkQuestionError("Select at least one available option.");
    const none = question.options!.find(option => /^none$/i.test(option.label));
    if (none && selected.includes(none.value) && selected.length > 1) throw new BkQuestionError("None cannot be combined with another option.");
    if (answer.detail !== undefined && (typeof answer.detail !== "string" || answer.detail.length > 250)) throw new BkQuestionError("Keep the explanation under 250 characters.");
    const detail = answer.detail?.trim() ?? "";
    if (selected.some(value => /other/i.test(question.options!.find(option => option.value === value)!.label)) && !detail) throw new BkQuestionError("Describe the other option.");
    return { selected, detail };
  }
  const values: Record<string, string> = {};
  for (const part of question.parts!) {
    const value = answer.values?.[part.key];
    if (typeof value !== "string" || !value.trim() || value.trim().length > part.max || (part.pattern && !new RegExp(part.pattern).test(value.trim()))) throw new BkQuestionError(`Provide a valid ${part.label.toLowerCase()} (up to ${part.max} characters).`);
    values[part.key] = value.trim();
  }
  return { values };
}
