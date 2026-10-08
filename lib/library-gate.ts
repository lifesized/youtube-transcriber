/**
 * Home page gate: first-time paste screen (FTU) vs Library.
 *
 * Server data wins over the localStorage flag. Rows created from the
 * extension or another client never set the flag in this browser, so the
 * flag only keeps an already-unlocked Library open (e.g. after deleting
 * every row).
 */

export const UNLOCK_KEY = "hasCreatedTranscript";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type LibraryView = "pending" | "ftu" | "library";

/** Fetch state of the transcript named by `?id=`. */
export type SelectedStatus = "none" | "loading" | "loaded" | "missing";

export function parseSelectedId(raw: string | null): string | null {
  return raw && ID_PATTERN.test(raw) ? raw : null;
}

export function libraryView(input: {
  unlocked: boolean;
  listLoading: boolean;
  rowCount: number;
  selected: SelectedStatus;
}): LibraryView {
  if (input.unlocked || input.rowCount > 0 || input.selected === "loaded") return "library";
  if (input.listLoading || input.selected === "loading") return "pending";
  return "ftu";
}

/** Persists the unlock once the Library is shown. Returns true when it did. */
export function rememberUnlock(
  storage: Pick<Storage, "setItem">,
  view: LibraryView
): boolean {
  if (view !== "library") return false;
  storage.setItem(UNLOCK_KEY, "true");
  return true;
}
