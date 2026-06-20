import type { Prompter } from "./prompter.js";

/** Project fields needed by the existing-project picker. */
interface PickableVercelProject {
  readonly id: string;
  readonly name: string;
}

/** Inputs for choosing from recent projects with optional server-side search. */
interface VercelProjectPickerOptions {
  readonly prompter: Prompter;
  readonly team: string;
  readonly projects: readonly PickableVercelProject[];
  search(query: string): Promise<readonly PickableVercelProject[]>;
}

const SEARCH_ALL_PROJECTS = "\0search-all-projects";

/** Shows recent projects and searches the full team scope on request. */
export async function pickExistingVercelProject(
  options: VercelProjectPickerOptions,
): Promise<PickableVercelProject> {
  let projects = options.projects;
  let showingSearchResults = false;

  while (true) {
    const selected = await options.prompter.select({
      message: "Project to link",
      ...(showingSearchResults
        ? { search: true as const, placeholder: "type to filter results" }
        : {}),
      options: [
        { value: SEARCH_ALL_PROJECTS, label: "Search all projects" },
        ...projects.map((project) => ({ value: project.id, label: project.name })),
      ],
      initialValue: projects[0]?.id,
    });
    if (selected !== SEARCH_ALL_PROJECTS) {
      const project = projects.find((candidate) => candidate.id === selected);
      if (project === undefined) throw new Error("Selected Vercel project is not available.");
      return project;
    }

    const query = (
      await options.prompter.text({
        message: "Project name to search",
        validate: (value) =>
          value.trim().length === 0 ? "Project name cannot be empty." : undefined,
      })
    ).trim();
    const found = await options.search(query);
    if (found.length === 0) {
      options.prompter.note(`No projects matched "${query}" in ${options.team}.`);
      projects = options.projects;
      showingSearchResults = false;
      continue;
    }
    projects = found;
    showingSearchResults = true;
  }
}
