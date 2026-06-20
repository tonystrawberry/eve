import { describe, expect, it, vi } from "vitest";

import { createFakePrompter } from "#internal/testing/fake-prompter.js";

import { pickExistingVercelProject } from "./vercel-project-picker.js";

describe("pickExistingVercelProject", () => {
  it("preserves CLI order and keeps full-team search reachable", async () => {
    const single = vi.fn((options) => {
      expect(options.options.map((option: { label: string }) => option.label)).toEqual([
        "Search all projects",
        "older",
        "newer",
      ]);
      expect(options.search).toBeUndefined();
      expect(options.initialValue).toBe("prj_old");
      return "prj_new";
    });
    const { prompter } = createFakePrompter({ single });

    await expect(
      pickExistingVercelProject({
        prompter,
        team: "team-a",
        projects: [
          { id: "prj_old", name: "older" },
          { id: "prj_new", name: "newer" },
        ],
        search: vi.fn(),
      }),
    ).resolves.toEqual({ id: "prj_new", name: "newer" });
  });

  it("replaces recents with full-team search results", async () => {
    const single = vi
      .fn()
      .mockImplementationOnce(
        (options) =>
          options.options.find(
            (option: { label: string }) => option.label === "Search all projects",
          )?.value,
      )
      .mockImplementationOnce((options) => {
        expect(options.options.map((option: { label: string }) => option.label)).toEqual([
          "Search all projects",
          "recent-updated",
          "found",
        ]);
        expect(options.search).toBe(true);
        expect(options.initialValue).toBe("prj_recent");
        return "prj_found";
      });
    const search = vi.fn(async () => [
      { id: "prj_recent", name: "recent-updated" },
      { id: "prj_found", name: "found" },
    ]);
    const { prompter } = createFakePrompter({ single, text: () => " found " });

    await expect(
      pickExistingVercelProject({
        prompter,
        team: "team-a",
        projects: [{ id: "prj_recent", name: "recent" }],
        search,
      }),
    ).resolves.toEqual({ id: "prj_found", name: "found" });
    expect(search).toHaveBeenCalledWith("found");
  });

  it("reports an empty server search and reopens the picker", async () => {
    const single = vi
      .fn()
      .mockImplementationOnce(
        (options) =>
          options.options.find(
            (option: { label: string }) => option.label === "Search all projects",
          )?.value,
      )
      .mockImplementationOnce((options) => {
        expect(options.options.map((option: { label: string }) => option.label)).toEqual([
          "Search all projects",
          "recent",
        ]);
        expect(options.search).toBeUndefined();
        expect(options.initialValue).toBe("prj_recent");
        return "prj_recent";
      });
    const { prompter } = createFakePrompter({ single, text: () => "missing" });

    await expect(
      pickExistingVercelProject({
        prompter,
        team: "team-a",
        projects: [{ id: "prj_recent", name: "recent" }],
        search: async () => [],
      }),
    ).resolves.toEqual({ id: "prj_recent", name: "recent" });
    expect(prompter.note).toHaveBeenCalledWith('No projects matched "missing" in team-a.');
  });
});
