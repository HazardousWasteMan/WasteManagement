import { describe, it, expect, beforeEach } from "vitest";
import {
  listProjects, getProject, addProject, updateProject,
  listCasesForProject, getCase, createCase, addWasteEntryToCase, __resetForTests,
} from "@/lib/projects";

describe("projects/cases store", () => {
  beforeEach(() => __resetForTests());

  it("seeds at least 3 projects, each with at least one case", () => {
    const projects = listProjects();
    expect(projects.length).toBeGreaterThanOrEqual(3);
    for (const p of projects) {
      expect(listCasesForProject(p.id).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every seed project has a non-empty name and location", () => {
    for (const p of listProjects()) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.location.length).toBeGreaterThan(0);
    }
  });

  it("every seed case belongs to a real, existing project, and every waste entry has a non-empty id", () => {
    const projectIds = new Set(listProjects().map(p => p.id));
    for (const p of listProjects()) {
      for (const c of listCasesForProject(p.id)) {
        expect(projectIds.has(c.projectId)).toBe(true);
        for (const entry of c.wasteEntries) {
          expect(entry.id.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("at least one seed waste entry is hazardous with a real avfallsstoffnr", () => {
    const allEntries = listProjects().flatMap(p => listCasesForProject(p.id)).flatMap(c => c.wasteEntries);
    const hazardous = allEntries.filter(e => e.isHazardous);
    expect(hazardous.length).toBeGreaterThan(0);
    expect(hazardous.some(e => e.avfallsstoffnr !== null)).toBe(true);
  });

  it("addProject persists and is retrievable by id", () => {
    const added = addProject({ name: "Test Project", location: "Testveien 1, Oslo" });
    expect(getProject(added.id)?.name).toBe("Test Project");
    expect(getProject(added.id)?.location).toBe("Testveien 1, Oslo");
    expect(listProjects().some(p => p.id === added.id)).toBe(true);
  });

  it("createCase creates a case with exactly one waste entry, scoped to its project", () => {
    const project = addProject({ name: "Test Project 2", location: "Testveien 2, Oslo" });
    const newCase = createCase({
      projectId: project.id,
      name: "Test Case",
      wasteEntry: { sampleLabel: "sample-a", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Clean concrete" },
      reportFileName: null,
    });
    expect(newCase.wasteEntries).toHaveLength(1);
    expect(newCase.wasteEntries[0].sampleLabel).toBe("sample-a");
    expect(newCase.wasteEntries[0].id.length).toBeGreaterThan(0);
    expect(newCase.reportFileName).toBeNull();
    expect(listCasesForProject(project.id).some(c => c.id === newCase.id)).toBe(true);
    expect(getCase(newCase.id)?.projectId).toBe(project.id);
  });

  it("addWasteEntryToCase appends a second entry without disturbing the first", () => {
    const project = addProject({ name: "Test Project 3", location: "Testveien 3, Oslo" });
    const newCase = createCase({
      projectId: project.id,
      name: "Test Case 2",
      wasteEntry: { sampleLabel: "sample-a", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Clean concrete" },
      reportFileName: null,
    });
    const updated = addWasteEntryToCase(newCase.id, {
      sampleLabel: "sample-b", isHazardous: true, ealCode: "17 05 03*", avfallsstoffnr: "7022", summary: "Contaminated soil",
    });
    expect(updated.wasteEntries).toHaveLength(2);
    expect(updated.wasteEntries[0].sampleLabel).toBe("sample-a");
    expect(updated.wasteEntries[1].sampleLabel).toBe("sample-b");
    expect(getCase(newCase.id)?.wasteEntries).toHaveLength(2);
  });

  it("createCase persists a real reportFileName and every seed case has one (possibly null)", () => {
    const project = addProject({ name: "Test Project 4", location: "Testveien 4, Oslo" });
    const newCase = createCase({
      projectId: project.id,
      name: "Test Case 3",
      wasteEntry: { sampleLabel: "sample-a", isHazardous: false, ealCode: "17 01 01", avfallsstoffnr: null, summary: "Clean concrete" },
      reportFileName: "AR-25-MM-118438-01.pdf",
    });
    expect(newCase.reportFileName).toBe("AR-25-MM-118438-01.pdf");
    expect(getCase(newCase.id)?.reportFileName).toBe("AR-25-MM-118438-01.pdf");
    for (const p of listProjects()) {
      for (const c of listCasesForProject(p.id)) {
        expect(c).toHaveProperty("reportFileName");
      }
    }
  });

  it("addWasteEntryToCase throws for a non-existent case id", () => {
    expect(() =>
      addWasteEntryToCase("does-not-exist", { sampleLabel: "x", isHazardous: false, ealCode: null, avfallsstoffnr: null, summary: "x" })
    ).toThrow();
  });

  it("updateProject persists a location change and is retrievable", () => {
    const project = addProject({ name: "Test Project 4", location: "Old location" });
    const updated = updateProject(project.id, { location: "New location" });
    expect(updated.location).toBe("New location");
    expect(getProject(project.id)?.location).toBe("New location");
    expect(getProject(project.id)?.name).toBe("Test Project 4");
  });

  it("updateProject throws for a non-existent project id", () => {
    expect(() => updateProject("does-not-exist", { location: "X" })).toThrow();
  });
});
