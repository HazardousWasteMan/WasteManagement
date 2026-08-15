"use client";
import { useState } from "react";
import { Card, Button } from "@heroui/react";
import { listProjects, type Project } from "@/lib/projects";

export function ProjectAssignmentStep({ suggestedName, suggestedLocation, onConfirm }: {
  suggestedName: string;
  suggestedLocation: string | null;
  onConfirm: (choice: { projectId: string } | { newProject: { name: string; location: string } }) => void;
}) {
  const [projects] = useState<Project[]>(() => listProjects());
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [isNewProject, setIsNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState(suggestedName);
  const [newProjectLocation, setNewProjectLocation] = useState(suggestedLocation ?? "");

  function handleConfirm() {
    if (isNewProject) {
      onConfirm({ newProject: { name: newProjectName.trim(), location: newProjectLocation.trim() } });
    } else {
      onConfirm({ projectId: selectedProjectId });
    }
  }

  const canConfirm = isNewProject
    ? newProjectName.trim() !== "" && newProjectLocation.trim() !== ""
    : selectedProjectId !== "";

  return (
    <Card>
      <Card.Content className="flex flex-col gap-3 py-6">
        <p className="text-sm font-medium text-forest">Which project does this belong to?</p>
        <select
          id="project-select"
          value={isNewProject ? "__new__" : selectedProjectId}
          onChange={e => {
            if (e.target.value === "__new__") {
              setIsNewProject(true);
              setSelectedProjectId("");
            } else {
              setIsNewProject(false);
              setSelectedProjectId(e.target.value);
            }
          }}
          className="border border-black/10 rounded-lg px-2 py-1 text-sm"
        >
          <option value="">— select a project —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name} — {p.location}</option>
          ))}
          <option value="__new__">+ New project</option>
        </select>

        {isNewProject && (
          <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-black/10">
            <label htmlFor="new-project-name" className="text-xs font-medium text-forest">Project name</label>
            <input
              id="new-project-name"
              type="text"
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            />
            <label htmlFor="new-project-location" className="text-xs font-medium text-forest">Location</label>
            <p className="text-xs text-black/60">
              {suggestedLocation
                ? "Pre-filled from the document — review and correct if needed."
                : "Not found in the document — enter it manually."}
            </p>
            <input
              id="new-project-location"
              type="text"
              value={newProjectLocation}
              onChange={e => setNewProjectLocation(e.target.value)}
              className="border border-black/10 rounded-lg px-2 py-1 text-sm"
            />
          </div>
        )}
      </Card.Content>
      <Card.Content className="py-4">
        <Button variant="primary" onPress={handleConfirm} isDisabled={!canConfirm}>
          Continue to facility match
        </Button>
      </Card.Content>
    </Card>
  );
}
