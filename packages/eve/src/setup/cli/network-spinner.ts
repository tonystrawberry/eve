import type { Prompter } from "../prompter.js";

/**
 * Runs a network reach behind a section-like spinner so the user sees the CLI
 * is working, not hung. The spinner clears whether the work resolves or throws,
 * and degrades to nothing when the prompter has no spinner (headless/test).
 */
export async function withNetworkSpinner<T>(
  prompter: Prompter,
  message: string,
  task: () => Promise<T>,
): Promise<T> {
  const spinner = prompter.log.spinner?.(message);
  try {
    return await task();
  } finally {
    spinner?.stop();
  }
}
