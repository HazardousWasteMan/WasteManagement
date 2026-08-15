
export interface Project {
  id: string;
  name: string;
  location: string;
  createdAt: number;
}

export interface WasteEntry {
  id: string;
  sampleLabel: string;
  isHazardous: boolean;
  ealCode: string | null;
  avfallsstoffnr: string | null; // Norwegian waste code; drives depot matching on the map
  summary: string;
}

export interface Case {
  id: string;
  projectId: string;
  name: string;
  createdAt: number;
  reportFileName: string | null;
  wasteEntries: WasteEntry[];
}

const PROJECTS_KEY = "projects-v1";
const CASES_KEY = "cases-v1";
function seedProjects(now: number): Project[] {
  const day = 86_400_000;
  return [
    { id: "seed-project-1", name: "Alta Lufthavn — PFAS-prosjektet", location: "Alta lufthavn, Alta", createdAt: now - 3 * day },
    { id: "seed-project-2", name: "Riveprosjekt Økern", location: "Økern, Oslo", createdAt: now - day },
    { id: "seed-project-3", name: "Tankgrav Sandnes", location: "Sandnes", createdAt: now - 60_000 },
  ];
}

function seedCases(now: number): Case[] {
  const day = 86_400_000;
  return [
    {
      id: "seed-case-1",
      projectId: "seed-project-1",
      name: "Betongprøver — batch 1",
      createdAt: now - 3 * day,
      reportFileName: null,
      wasteEntries: [
        { id: "seed-entry-1", sampleLabel: "ENAT-BØF1-BO9OB1", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Non-hazardous concrete." },
        { id: "seed-entry-2", sampleLabel: "Kreosotimpregnert trevirke", isHazardous: true, ealCode: "17 02 04*", avfallsstoffnr: "7098", summary: "Hazardous: kreosotimpregnert trevirke (avfallsstoffnr 7098)." },
      ],
    },
    {
      id: "seed-case-2",
      projectId: "seed-project-2",
      name: "Rivemasser",
      createdAt: now - day,
      reportFileName: null,
      wasteEntries: [
        { id: "seed-entry-3", sampleLabel: "Betongrester", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Non-hazardous concrete. Eligible for ordinary municipal facilities." },
      ],
    },
    {
      id: "seed-case-3",
      projectId: "seed-project-3",
      name: "Grunnundersøkelse",
      createdAt: now - 60_000,
      reportFileName: null,
      wasteEntries: [
        { id: "seed-entry-4", sampleLabel: "Oljeforurenset masse", isHazardous: true, ealCode: "17 05 03*", avfallsstoffnr: "7022", summary: "Hazardous: oljeforurenset masse (avfallsstoffnr 7022). Requires treatment at a licensed receiver." },
        { id: "seed-entry-5", sampleLabel: "Spillolje — verkstedtank", isHazardous: true, ealCode: "13 02 05*", avfallsstoffnr: "7011", summary: "Hazardous: refusjonsberettiget spillolje (avfallsstoffnr 7011). Licensed receivers highlighted on the map." },
      ],
    },
  ];
}

// localStorage in the browser, plain map in tests/SSR (Node has a non-functional localStorage stub)
let memoryProjects: Project[] | null = null;
let memoryCases: Case[] | null = null;

function hasStorage(): boolean {
  return typeof localStorage !== "undefined" && typeof localStorage.getItem === "function";
}

function loadProjects(): Project[] {
  if (!hasStorage()) {
    if (!memoryProjects) memoryProjects = seedProjects(Date.now());
    return memoryProjects;
  }
  const raw = localStorage.getItem(PROJECTS_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as Project[];
    } catch {
      // fall through to reseed
    }
  }
  const fresh = seedProjects(Date.now());
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveProjects(all: Project[]) {
  if (!hasStorage()) {
    memoryProjects = all;
    return;
  }
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(all));
}

function loadCases(): Case[] {
  if (!hasStorage()) {
    if (!memoryCases) memoryCases = seedCases(Date.now());
    return memoryCases;
  }
  const raw = localStorage.getItem(CASES_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as Case[];
    } catch {
      // fall through to reseed
    }
  }
  const fresh = seedCases(Date.now());
  localStorage.setItem(CASES_KEY, JSON.stringify(fresh));
  return fresh;
}

function saveCases(all: Case[]) {
  if (!hasStorage()) {
    memoryCases = all;
    return;
  }
  localStorage.setItem(CASES_KEY, JSON.stringify(all));
}

export function listProjects(): Project[] {
  return [...loadProjects()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getProject(id: string): Project | undefined {
  return loadProjects().find(p => p.id === id);
}

export function addProject(input: { name: string; location: string }): Project {
  const project: Project = {
    id: crypto.randomUUID(),
    name: input.name,
    location: input.location,
    createdAt: Date.now(),
  };
  saveProjects([...loadProjects(), project]);
  return project;
}

export function listCasesForProject(projectId: string): Case[] {
  return loadCases()
    .filter(c => c.projectId === projectId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function getCase(id: string): Case | undefined {
  return loadCases().find(c => c.id === id);
}

export function createCase(input: { projectId: string; name: string; wasteEntry: Omit<WasteEntry, "id">; reportFileName: string | null }): Case {
  const newCase: Case = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    name: input.name,
    createdAt: Date.now(),
    reportFileName: input.reportFileName,
    wasteEntries: [{ ...input.wasteEntry, id: crypto.randomUUID() }],
  };
  saveCases([...loadCases(), newCase]);
  return newCase;
}

export function updateProject(id: string, updates: Partial<Pick<Project, "name" | "location">>): Project {
  const all = loadProjects();
  const idx = all.findIndex(p => p.id === id);
  if (idx === -1) throw new Error(`Project ${id} not found`);
  const updated: Project = { ...all[idx], ...updates };
  const next = [...all];
  next[idx] = updated;
  saveProjects(next);
  return updated;
}

export function addWasteEntryToCase(caseId: string, entry: Omit<WasteEntry, "id">): Case {
  const all = loadCases();
  const idx = all.findIndex(c => c.id === caseId);
  if (idx === -1) throw new Error(`Case ${caseId} not found`);
  const updated: Case = { ...all[idx], wasteEntries: [...all[idx].wasteEntries, { ...entry, id: crypto.randomUUID() }] };
  const next = [...all];
  next[idx] = updated;
  saveCases(next);
  return updated;
}

export function __resetForTests() {
  memoryProjects = null;
  memoryCases = null;
  if (hasStorage()) {
    localStorage.removeItem(PROJECTS_KEY);
    localStorage.removeItem(CASES_KEY);
  }
}
