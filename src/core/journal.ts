/**
 * Write-ahead journal.
 *
 * The agent has full write autonomy and Marvin has no undo, so every mutating op
 * records the before-state of each document it touches. `marvin undo` replays the
 * most recent change set backwards. This adds no friction during normal use: it
 * is append-only and never prompts.
 */

import { appendFile, mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "os";

export interface Change {
  id: string;
  /** Field values as they were before the write. null means "did not exist". */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface ChangeSet {
  ts: number;
  op: string;
  changes: Change[];
  /** Set once `undo` has reverted this entry, so it is not reverted twice. */
  undone?: boolean;
}

export function defaultJournalPath(): string {
  return join(process.env.MARVIN_HOME ?? join(homedir(), ".marvin"), "journal.jsonl");
}

export class Journal {
  constructor(private readonly path: string = defaultJournalPath()) {}

  async record(op: string, changes: Change[]): Promise<void> {
    if (changes.length === 0) return;
    const entry: ChangeSet = { ts: Date.now(), op, changes };
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(entry) + "\n", "utf8");
  }

  async readAll(): Promise<ChangeSet[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as ChangeSet;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is ChangeSet => entry !== null);
  }

  /** Most recent change set that has not already been undone. */
  async lastUndoable(): Promise<ChangeSet | null> {
    const all = await this.readAll();
    for (let i = all.length - 1; i >= 0; i--) {
      if (!all[i].undone) return all[i];
    }
    return null;
  }

  /**
   * Rewrite the log with the matching entry marked undone. The journal is small
   * (one line per mutating command) so a full rewrite is cheaper than an index.
   */
  async markUndone(ts: number): Promise<void> {
    const all = await this.readAll();
    const updated = all.map((entry) =>
      entry.ts === ts ? { ...entry, undone: true } : entry
    );
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      updated.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      "utf8"
    );
  }
}
