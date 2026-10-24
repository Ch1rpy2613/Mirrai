/**
 * The safety layer's gentle nudges.
 *
 * The server decides *when* to nudge and sends a `textKey` that points at a
 * dictionary entry, so the wording follows the interface language. The
 * Chinese text the server sends along is the fallback for a client whose
 * dictionary does not know the key yet.
 */

export interface CareNote {
  kind: string;
  text: string;
  textKey?: string;
  showBanner?: boolean;
}

type Translate = (key: any, params?: any) => string;

/**
 * The text to show for a care note.
 *
 * The dictionary lookup can miss — a key the client does not have, or a
 * server that is newer than the client. In that case the server's own text
 * is better than nothing.
 */
export function careNoteText(
  note: CareNote | null | undefined,
  t: Translate,
): string {
  if (!note) return "";
  if (note.textKey) {
    const translated = t(note.textKey);
    if (translated && translated !== note.textKey) return translated;
  }
  return note.text;
}
