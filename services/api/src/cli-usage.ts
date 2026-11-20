/**
 * The CLI's help text. Kept in its own module so the tests can import it without
 * pulling in the rest of the CLI (which opens databases when run), and so the
 * drift test in test/service.test.ts can hold the README's examples against it.
 */
export const USAGE = `concord — reconcile tokenized securities on Stellar against the register

Workspace commands. Name the workspace with --org <id | exact name> or CONCORD_ORG.

  watch <CODE:ISSUER | CONTRACT>   start indexing an asset
        [--network mainnet|testnet] [--name N] [--ignore A,B]
        [--from LEDGER] [--no-baseline] [--decimals D]
  unwatch ASSET                    stop watching; deletes the asset and its books
  rebuild ASSET                    re-index from fresh opening balances; books stay
  assets                           list watched assets
  sync [ASSET]                     pull new events (every workspace when no --org)
  holdings ASSET [--as-of ISO]     on-chain holders
  register ASSET FILE --as-of ISO  import a register export and reconcile it
  journal ASSET FILE               import the register's transaction journal
  instructions ASSET FILE          import control instructions
  reconcile ASSET [--register ID]  re-run a reconciliation
  action ASSET dividend --record ISO --rate R [--pay-asset A] [--payer G...] [--until ISO]
  action ASSET split|redemption --record ISO --ratio NUM:DEN [--until ISO]
        [--label TEXT] [--exclude A,B]
  actions ASSET                    corporate actions and their state
  controls ASSET                   freeze, authorisation and clawback log
  export ASSET [--from ISO] [--to ISO] [--csv SECTION] [--out FILE]

Operator commands.

  orgs                             list workspaces
  purge-expired                    remove expired identity records
  signup-code [--note TEXT]        a code that lets one new workspace be created (CONCORD_SIGNUP=code)
  reset-link EMAIL                 a one-day link for setting a new password
  org-delete ORG                   delete a workspace and everything in it
  backup DIR                       copy every database to DIR while the server runs
  serve                            run the API and dashboard

ASSET is a code or a contract id. Add --json to most commands for machine-readable output,
or --help (-h) to see this text. Settings come from the environment; see .env.example.`;

/** Edit distance between two short strings, for "did you mean" suggestions. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** The known flag closest to `flag` (both with leading dashes), or undefined when nothing is near. */
export function suggestFlag(flag: string, known: readonly string[]): string | undefined {
  const name = flag.replace(/^-+/, "");
  let best: { flag: string; d: number } | undefined;
  for (const k of known) {
    const d = distance(name, k);
    if (!best || d < best.d) best = { flag: k, d };
  }
  return best && best.d <= Math.max(2, Math.floor(name.length / 3)) ? `--${best.flag}` : undefined;
}

/**
 * Turns a `util.parseArgs` failure into one friendly line, or returns undefined
 * when the error is not an argument-parsing error.
 */
export function usageErrorMessage(err: unknown, known: readonly string[]): string | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== "string" || !code.startsWith("ERR_PARSE_ARGS_")) return undefined;
  const text = (err as Error).message;
  const help = "Run 'concord --help' for usage.";
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    const flag = /Unknown option '([^']+)'/.exec(text)?.[1] ?? "option";
    const hint = suggestFlag(flag, known);
    return `unknown option '${flag}'.${hint ? ` Did you mean '${hint}'?` : ""} ${help}`;
  }
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE") {
    const flag = /Option '([^']+?)(?: <value>)?[,' ]/.exec(text)?.[1] ?? "option";
    return `option '${flag}' needs a value. ${help}`;
  }
  return `${text.split(/\.\s/)[0]!.replace(/\.$/, "")}. ${help}`;
}
