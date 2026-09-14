import { getProductionApplication } from "@/lib/production/server";
import { sameOrigin, productionError } from "@/lib/production/http";
import { ProjectInputError } from "@/lib/production/process-document";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const { store } = await getProductionApplication();
    const body = await request.json();
    if (!body || typeof body.name !== "string" || !body.name.trim() || body.name.length > 200 || (body.location != null && (typeof body.location !== "string" || body.location.length > 500))) throw new ProjectInputError("Enter a project name (up to 200 characters) and optional location (up to 500 characters).");
    const project = await store.createProject({ name: body.name.trim(), location: body.location?.trim() || "" });
    return Response.json({ project }, { status: 201 });
  } catch (error) { return productionError(error); }
}
