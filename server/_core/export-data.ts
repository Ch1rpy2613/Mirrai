/**
 * The user's data, in a form they can keep.
 *
 * The export used to produce an HTML page with the messages, the memories
 * and the diary — and it left out the farewell letter, the relationship
 * events, the user's own moods, the emotion snapshots and the summaries.
 * It was also HTML only, and the template was hardcoded Chinese, so an
 * English user got a Chinese document.
 *
 * "My data" means all of it, in a format that does not need this app.
 */
import * as db from "../db";
import { computeIntimacy } from "./persona-utils";
import { copy, type Locale } from "@shared/copy";
import { intimacyLevelLabel } from "@shared/intimacy";
import {
  USER_MOOD_LABELS,
  EVENT_LABELS,
  type UserMood,
  type RelationshipEventKind,
} from "@shared/user-side";

/**
 * How many messages one persona's export carries.
 *
 * The whole bundle is held in memory and then serialised into one
 * string, so the ceiling is a memory ceiling rather than a policy one.
 * Ten thousand messages is a long conversation; a hundred thousand is a
 * hundred megabytes of JSON per persona.
 */
const MAX_EXPORT_MESSAGES = 10_000;

/**
 * How many memories one persona's export carries.
 *
 * The same reasoning as the messages: the bundle is held in memory.
 */
const MAX_EXPORT_MEMORIES = 10_000;

export interface ExportBundle {
  /**
   * The language the export reads in.
   *
   * It is not part of the data — the JSON is the same in both languages —
   * but the Markdown has headings, and headings have to be in the
   * language of the person who is going to read the file.
   */
  locale?: Locale;
  user: {
    username: string;
    name: string | null;
    email: string | null;
    timezone: string | null;
    addressStyle: string | null;
    boundaries: string | null;
    createdAt: Date;
  };
  personas: Array<{
    id: number;
    name: string;
    relationshipDesc: string | null;
    togetherFrom: string | null;
    togetherTo: string | null;
    emotionalState: string;
    personaData: unknown;
    graduationStatus: string | null;
    graduatedAt: Date | null;
    farewellLetter: string | null;
    presence: string;
    timezone: string | null;
    intimacy: { score: number; level: string };
    messages: Array<{
      role: string;
      content: string;
      emotionalState: string | null;
      messageType: string | null;
      createdAt: Date;
    }>;
    memories: Array<{
      title: string;
      description: string | null;
      category: string;
      date: string | null;
      createdAt: Date;
    }>;
    diaries: Array<{ date: string; summary: string; reflection: string | null }>;
    snapshots: Array<{ emotionalState: string; messageCount: number; date: string }>;
    events: Array<{
      kind: RelationshipEventKind;
      title: string;
      detail: string | null;
      happenedAt: Date;
    }>;
    /**
     * The letters — what was written, and what came back.
     *
     * They are the one artefact the export used to leave out, and they
     * are the ones somebody would most want to keep: a letter you wrote
     * at two in the morning, and the reply that came a day later.
     */
    letters: Array<{
      body: string;
      kind: string;
      mood: string | null;
      status: string;
      replyText: string | null;
      repliedAt: Date | null;
      createdAt: Date;
    }>;
  }>;
  /** The user's own moods, across every persona's time. */
  moods: Array<{ date: string; mood: UserMood; note: string | null }>;
}

/**
 * Everything the user has, in one structure.
 */
export async function buildExportBundle(userId: number): Promise<ExportBundle | null> {
  const user = await db.getUserById(userId);
  if (!user) return null;

  // The export reads in the language the user reads. The request that
  // asked for it may know better, and can pass its own locale in, but the
  // saved preference is what the file should follow when nobody says.
  const locale = await db.getUserLocale(userId).catch(() => "zh" as Locale);

  const personaList = await db.getPersonasByUserId(userId);
  const moods = await db.getUserMoods(userId, 3650);

  const personas: ExportBundle["personas"] = [];
  for (const persona of personaList) {
    const [messageList, memoryList, diaryList, snapshotList, eventList, letterList] = await Promise.all([
      // The export is loaded into memory, put into one object and then
      // serialised into one string. A hundred thousand messages per
      // persona is hundreds of megabytes, and the process that builds it
      // runs out of memory — taking every other request with it.
      db.getMessagesByPersonaId(persona.id, userId, MAX_EXPORT_MESSAGES),
      // All of them. The list used to carry the interface's own limit of
      // two hundred, so the export — which says "all of my data" —
      // silently left out everything past the two hundredth memory.
      db.getMemoriesByPersonaId(persona.id, userId, MAX_EXPORT_MEMORIES),
      db.getDiaryEntries(userId, persona.id, 10000),
      db.getEmotionSnapshots(persona.id, userId, 36500),
      db.getRelationshipEvents(persona.id, userId, 1000),
      // Ten thousand, like the other lists — a thousand dropped the
      // *oldest* letters, from a bundle that says "all of my data".
      db.getLetters(persona.id, userId, 10000),
    ]);
    const intimacyData = await db.getIntimacyData(persona.id, userId);
    const intimacy = computeIntimacy(intimacyData);

    personas.push({
      id: persona.id,
      name: persona.name,
      relationshipDesc: persona.relationshipDesc,
      togetherFrom: persona.togetherFrom,
      togetherTo: persona.togetherTo,
      emotionalState: persona.emotionalState,
      personaData: persona.personaData,
      graduationStatus: persona.graduationStatus,
      graduatedAt: persona.graduatedAt,
      farewellLetter: persona.farewellLetter,
      presence: persona.presence,
      timezone: persona.timezone,
      intimacy,
      messages: messageList.map((m) => ({
        role: m.role,
        content: m.content,
        emotionalState: m.emotionalState,
        messageType: m.messageType,
        createdAt: m.createdAt,
      })),
      memories: memoryList.map((m) => ({
        title: m.title,
        description: m.description,
        category: m.category,
        // Whose memory this is — the user's or the persona's.
        subject: (m as any).subject ?? "them",
        date: m.date,
        createdAt: m.createdAt,
      })),
      diaries: diaryList.map((d) => ({
        date: d.date,
        summary: d.summary,
        reflection: d.reflection,
      })),
      snapshots: snapshotList.map((s) => ({
        emotionalState: s.emotionalState,
        messageCount: s.messageCount,
        date: s.date,
      })),
      events: eventList.map((e) => ({
        kind: e.kind as RelationshipEventKind,
        title: e.title,
        detail: e.detail,
        happenedAt: e.happenedAt,
      })),
      letters: letterList.map((l) => ({
        body: l.body,
        kind: l.kind,
        mood: l.mood,
        status: l.status,
        replyText: l.replyText,
        repliedAt: l.repliedAt,
        createdAt: l.createdAt,
      })),
    });
  }

  return {
    locale,
    user: {
      username: user.username,
      name: user.name,
      email: user.email,
      timezone: user.timezone,
      addressStyle: user.addressStyle,
      boundaries: user.boundaries,
      createdAt: user.createdAt,
    },
    personas,
    moods: moods.map((m) => ({ date: m.date, mood: m.mood as UserMood, note: m.note })),
  };
}

/**
 * The bundle as JSON.
 *
 * Dates are written as ISO strings, so the file is readable by anything.
 */
export function exportAsJson(bundle: ExportBundle): string {
  // The locale is not data — it only decides the language of the
  // Markdown — so it does not belong in the file the user keeps.
  const { locale, ...data } = bundle;
  void locale;
  return JSON.stringify(data, null, 2);
}

/**
 * The bundle as Markdown.
 *
 * A keepsake that can be read in any editor, printed, or pasted into
 * something else without this app.
 *
 * The wording follows the language of the export: a document somebody is
 * going to read years from now should not be half in a language they do
 * not speak.
 */
export function exportAsMarkdown(bundle: ExportBundle, locale: Locale = bundle.locale ?? "zh"): string {
  const lines: string[] = [];
  const iso = (value: Date | string | null | undefined) =>
    value ? new Date(value).toISOString().slice(0, 10) : "";

  lines.push(`# ${bundle.user.name || bundle.user.username}`);
  lines.push("");
  lines.push(`> ${copy(locale, "labels.export.exportedOn", { date: new Date().toISOString().slice(0, 10) })}`);
  lines.push("");

  if (bundle.moods.length > 0) {
    lines.push(`## ${copy(locale, "labels.export.myState")}`);
    lines.push("");
    for (const mood of bundle.moods) {
      /**
       * The mood is named, not coded.
       *
       * The stored key was printed as it is — "great", "down" — in a
       * file that is otherwise in the reader's language. The labels
       * already existed; they were simply not used here.
       */
      const label = USER_MOOD_LABELS[mood.mood]?.[locale] ?? mood.mood;
      lines.push(`- ${mood.date} · ${label}${mood.note ? ` — ${mood.note}` : ""}`);
    }
    lines.push("");
  }

  for (const persona of bundle.personas) {
    lines.push(`# ${persona.name}`);
    lines.push("");
    if (persona.relationshipDesc) lines.push(`*${persona.relationshipDesc}*`);
    lines.push("");
    lines.push(`- ${copy(locale, "labels.export.intimacy", {
      score: persona.intimacy.score,
      level: intimacyLevelLabel(persona.intimacy.level, locale),
    })}`);
    if (persona.togetherFrom) {
      lines.push(`- ${persona.togetherTo
        ? copy(locale, "labels.export.togetherRange", {
            from: persona.togetherFrom,
            to: persona.togetherTo,
          })
        : copy(locale, "labels.export.togetherOngoing", { from: persona.togetherFrom })}`);
    }
    lines.push("");

    if (persona.farewellLetter) {
      lines.push(`## ${copy(locale, "labels.export.farewellLetter")}`);
      lines.push("");
      lines.push(persona.farewellLetter);
      lines.push("");
    }

    if (persona.events.length > 0) {
      lines.push(`## ${copy(locale, "labels.export.events")}`);
      lines.push("");
      for (const event of persona.events) {
        // The kind is named, not coded: "breakup" is not a thing to
        // read years from now.
        const kind = EVENT_LABELS[event.kind]?.[locale] ?? event.kind;
        lines.push(`- ${iso(event.happenedAt)} · ${kind} · ${event.title}`);
        if (event.detail) lines.push(`  - ${event.detail}`);
      }
      lines.push("");
    }

    if (persona.memories.length > 0) {
      lines.push(`## ${copy(locale, "labels.export.memories")}`);
      lines.push("");
      for (const memory of persona.memories) {
        lines.push(`- **${memory.title}**${memory.date ? ` (${memory.date})` : ""}${memory.description ? `\n  ${memory.description}` : ""}`);
      }
      lines.push("");
    }

    if (persona.letters.length > 0) {
      lines.push(`## ${copy(locale, "labels.export.letters")}`);
      lines.push("");
      for (const letter of persona.letters) {
        const todo = letter.kind === "todo" ? ` · ${copy(locale, "labels.export.letterTodo")}` : "";
        lines.push(`### ${iso(letter.createdAt)}${todo}`);
        lines.push("");
        lines.push(letter.body);
        if (letter.replyText) {
          lines.push("");
          lines.push(`> ${letter.replyText}`);
          lines.push("");
          if (letter.repliedAt) {
            lines.push(`*${iso(letter.repliedAt)}*`);
            lines.push("");
          }
        }
      }
    }

    if (persona.diaries.length > 0) {
      lines.push(`## ${copy(locale, "labels.export.diaries")}`);
      lines.push("");
      for (const diary of persona.diaries) {
        lines.push(`### ${diary.date}`);
        lines.push("");
        lines.push(diary.summary);
        if (diary.reflection) {
          lines.push("");
          lines.push(`> ${diary.reflection}`);
        }
        lines.push("");
      }
    }

    lines.push(`## ${copy(locale, "labels.export.transcript")}`);
    lines.push("");
    for (const message of persona.messages) {
      const who = message.role === "user" ? copy(locale, "labels.export.speakerMe") : persona.name;
      /**
       * The time, as it was written.
       *
       * The column holds a wall clock with no time zone in it — the
       * server's own — and `toISOString()` converts it to UTC. So the
       * exported times did not match the times in the app: on a server
       * east of Greenwich every message was written down an hour or
       * more early.
       */
      const stamp = new Date(message.createdAt);
      const when = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")} ${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}`;
      lines.push(`**${who}** · ${when}`);
      lines.push("");
      lines.push(message.content);
      lines.push("");
    }
  }

  return lines.join("\n");
}
