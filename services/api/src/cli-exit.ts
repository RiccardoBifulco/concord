/** Exit code for a clean run, or when `--fail-on-breaks` is not set. */
export const EXIT_OK = 0;
/** Exit code for any error. */
export const EXIT_ERROR = 1;
/** Exit code for `--fail-on-breaks` when the run has open breaks. */
export const EXIT_BREAKS = 2;

/**
 * The exit code for a finished reconciliation. Only open breaks count: a break that has been
 * acknowledged or resolved was signed off by a person and does not fail the run.
 */
export function exitCodeForRun(run: { breaks: Array<{ status: string }> }, failOnBreaks: boolean): number {
  if (!failOnBreaks) return EXIT_OK;
  return run.breaks.some((b) => b.status === "open") ? EXIT_BREAKS : EXIT_OK;
}
