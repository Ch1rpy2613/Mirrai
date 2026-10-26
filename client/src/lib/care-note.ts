/**
 * The safety layer's gentle nudges.
 *
 * The server decides *when* to nudge and sends a `textKey` that points at a
 * dictionary entry, so the wording follows the interface language. The
 * Chinese text the server sends along is the fallback for a client whose
 * dictionary does not know the key yet.
 *
 * The note itself is appended to the persona's reply by the server — it is
 * the persona saying it, in its own voice. What the interface adds on top
 * is the banner.
 */

export interface CareNote {
  kind: string;
  text: string;
  textKey?: string;
  showBanner?: boolean;
}

type Translate = (key: any, params?: any) => string;

/**
 * The banner to show for a care note.
 *
 * The note itself is appended to the persona's reply — it is the persona
 * saying it, in its own voice. The banner is the *app* saying it, and it is
 * a different sentence: showing the note in both places meant the user read
 * the same line twice, once as a message and once as a toast.
 *
 * An empty string means "no banner": either the note did not ask for one,
 * or the client does not know the banner's wording.
 */
export function careBannerText(
  note: CareNote | null | undefined,
  t: Translate,
): string {
  if (!note?.showBanner) return "";

  /**
   * The banner that matches the note.
   *
   * The note's own key was ignored — so every banner was the same
   * sentence, "you have talked a lot today". The dependency warning is
   * the product's own named safety risk, and it reached the user
   * dressed as a rest suggestion: the one warning that most needed to
   * be different was the one that was not.
   */
  const key = bannerKeyFor(note.textKey);
  const translated = t(key);
  if (translated && translated !== key) return translated;

  // A client whose dictionary is behind the server falls back to the
  // one line it does know.
  const fallback = t("safety.usageBanner");
  if (fallback && fallback !== "safety.usageBanner") return fallback;
  return "";
}

/**
 * The banner key for a care note's key.
 *
 * The server sends the key of the *note*; the banner is a different
 * sentence for the same thing.
 */
function bannerKeyFor(textKey: string | undefined): string {
  switch (textKey) {
    case "safety.care.dependency":
      return "safety.banner.dependency";
    case "safety.care.longSession":
      return "safety.banner.longSession";
    case "safety.care.dailyLimit":
      return "safety.banner.dailyLimit";
    default:
      return "safety.usageBanner";
  }
}
