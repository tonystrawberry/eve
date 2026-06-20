import { HumanActionRequiredError } from "#setup/human-action.js";
import { captureVercel, type VercelCaptureFailure } from "#setup/primitives/index.js";
import { z } from "zod";

import { isForbiddenApiFailure } from "./vercel-api-failure.js";
import type { VercelProjectOperationOptions } from "./project-resolution.js";

export type { VercelProjectOperationOptions };

const PROJECT_LIST_TIMEOUT_MS = 15_000;

const VercelTeamListEntrySchema = z.object({
  name: z.string(),
  slug: z.string(),
  current: z.boolean(),
});

/** One Vercel account scope returned by `vercel teams ls`. */
type VercelTeamListEntry = z.infer<typeof VercelTeamListEntrySchema>;

const VercelProjectListEntrySchema = z.object({
  name: z.string(),
  id: z.string(),
});

/** Project identity used by the existing-project picker. */
type VercelProjectListEntry = z.infer<typeof VercelProjectListEntrySchema>;

const VercelPaginationSchema = z.object({
  next: z.number().int().nonnegative().nullable().optional(),
});

const VercelTeamPageSchema = z.object({
  teams: z.array(VercelTeamListEntrySchema),
  pagination: VercelPaginationSchema.optional(),
});

const VercelProjectPageSchema = z.object({
  projects: z.array(VercelProjectListEntrySchema),
  pagination: VercelPaginationSchema.optional(),
});

interface VercelTeamPage {
  readonly teams: VercelTeamListEntry[];
  readonly next?: number;
}

interface VercelProjectPage {
  readonly projects: VercelProjectListEntry[];
  readonly next?: number;
}

/** Parses one JSON response captured from the Vercel CLI. */
export function parseVercelJson(stdout: string, description: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Could not parse ${description} JSON from Vercel CLI output.`);
  }
}

function parseTeamPage(stdout: string): VercelTeamPage {
  const parsed = VercelTeamPageSchema.safeParse(parseVercelJson(stdout, "teams"));
  if (!parsed.success) throw new Error("Could not read teams from Vercel CLI JSON output.");
  const next = parsed.data.pagination?.next;
  return next === null || next === undefined
    ? { teams: parsed.data.teams }
    : { teams: parsed.data.teams, next };
}

function parseProjectPage(stdout: string): VercelProjectPage {
  const parsed = VercelProjectPageSchema.safeParse(parseVercelJson(stdout, "projects"));
  if (!parsed.success) throw new Error("Could not read projects from Vercel CLI JSON output.");
  const next = parsed.data.pagination?.next;
  return next === null || next === undefined
    ? { projects: parsed.data.projects }
    : { projects: parsed.data.projects, next };
}

/** Converts a scoped API denial into the Vercel re-authentication action. */
export function requireVercelTeamAccess(failure: VercelCaptureFailure): never {
  const stderr = failure.stderr.trim();
  const detail = stderr ? ` ${stderr}` : "";
  throw new HumanActionRequiredError({
    kind: "vercel-forbidden",
    command: "vercel login",
    reason: `Vercel denied access to this scope.${detail} Re-authenticate (for example to complete a team's SSO) or switch to a team you can access.`,
  });
}

/** Lists every Vercel scope available to the current CLI user. */
export async function listTeams(
  projectRoot: string,
  options: VercelProjectOperationOptions = {},
): Promise<VercelTeamListEntry[]> {
  const teams = new Map<string, VercelTeamListEntry>();
  const cursors = new Set<number>();
  let next: number | undefined;

  while (true) {
    const args = ["teams", "ls", "--format", "json"];
    if (next !== undefined) args.push("--next", String(next));
    const result = await captureVercel(args, { cwd: projectRoot, signal: options.signal });
    options.signal?.throwIfAborted();
    if (!result.ok) {
      if (isForbiddenApiFailure(result.failure)) requireVercelTeamAccess(result.failure);
      throw new Error(`Could not list Vercel teams. ${result.failure.message}`);
    }

    const page = parseTeamPage(result.stdout);
    for (const team of page.teams) teams.set(team.slug, team);
    if (page.next === undefined) return [...teams.values()];
    if (cursors.has(page.next)) {
      throw new Error("Vercel returned a repeated pagination cursor for Vercel teams.");
    }
    cursors.add(page.next);
    next = page.next;
  }
}

async function fetchProjectPage(
  projectRoot: string,
  team: string,
  options: VercelProjectOperationOptions & { readonly search?: string; readonly next?: number },
): Promise<VercelProjectPage> {
  const args = ["project", "ls", "--format", "json", "--scope", team];
  if (options.search !== undefined) args.push("--filter", options.search);
  if (options.next !== undefined) args.push("--next", String(options.next));
  const result = await captureVercel(args, {
    cwd: projectRoot,
    signal: options.signal,
    timeoutMs: PROJECT_LIST_TIMEOUT_MS,
  });
  options.signal?.throwIfAborted();
  if (!result.ok) {
    if (isForbiddenApiFailure(result.failure)) requireVercelTeamAccess(result.failure);
    throw new Error(`Could not list Vercel projects in ${team}. ${result.failure.message}`);
  }
  return parseProjectPage(result.stdout);
}

/** Lists the 20 most recent Vercel projects in one account scope. */
export async function listRecentProjects(
  projectRoot: string,
  team: string,
  options: VercelProjectOperationOptions = {},
): Promise<VercelProjectListEntry[]> {
  return (await fetchProjectPage(projectRoot, team, options)).projects;
}

/** Searches every matching Vercel project page in one account scope. */
export async function searchProjects(
  projectRoot: string,
  team: string,
  query: string,
  options: VercelProjectOperationOptions = {},
): Promise<VercelProjectListEntry[]> {
  const search = query.trim();
  if (search.length === 0) throw new Error("Project search query cannot be empty.");

  const projects = new Map<string, VercelProjectListEntry>();
  const cursors = new Set<number>();
  let next: number | undefined;

  while (true) {
    const pageOptions: VercelProjectOperationOptions & {
      search: string;
      next?: number;
    } = { ...options, search };
    if (next !== undefined) pageOptions.next = next;
    const page = await fetchProjectPage(projectRoot, team, pageOptions);
    for (const project of page.projects) projects.set(project.id, project);
    if (page.next === undefined) return [...projects.values()];
    if (cursors.has(page.next)) {
      throw new Error(
        `Vercel returned a repeated pagination cursor for project search in ${team}.`,
      );
    }
    cursors.add(page.next);
    next = page.next;
  }
}
