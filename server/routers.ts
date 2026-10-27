import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { createSessionToken } from "./_core/auth";
import { isUniqueViolation } from "./_core/auth";
import { detectCrisis } from "./safety/crisis";
import { withKeyLock } from "./_core/lock";
import { requestAbortSignal } from "./_core/context";
import { extractMemories } from "./chat/memory-extract";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router, rateLimit } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { llmService, registry } from "./llm";
import type { InvokeParams, InvokeResult } from "./llm/types";
import { getTextContent } from "./llm/types";
import {
  invalidateUserProviderCache,
  resolveProviderForUser,
  resolveProviderForUserWithOwnership,
} from "./llm/user-provider";
import { storagePut } from "./storage";
import {
  createPersona, getPersonasByUserId, getPersonaById, updatePersona, deletePersona,
  getPersonasWithStats, getUserStats, getRecentActivity, getDailyChatCounts,
  createPersonaFile, getFilesByPersonaId,
  createMessage,
  getPersonaFileById, getMessagesByPersonaId, getMessagesByPersonaIdPaged, clearMessagesByPersonaId, searchMessages,
  updateUserMessage, deleteMessage, deleteMessagesFrom, getPreviousMessage,
  getMessagesFrom, restoreMessages,
  getMessagesBefore, hasOlderMessages, searchAllMessages,
  createWechatBinding, getWechatBindingsByUserId, deleteWechatBinding, setWechatBindingPersona,
  getSkillJobById, updateSkillJob, getLlmConfigsByUserId, upsertLlmConfig, setDefaultLlmConfig, getDefaultLlmConfig,
  getResearchProfilesByPersonaId,
  updateUserProfile, updateUserPassword, deleteUserAccount, getAccountStats, exportUserData,
  getUserById, bumpUserTokenVersion, updateUserGraduationMode, updateUserTrajectoryAssessment,
  getUserTimezone,
  createMemory, getMemoriesByPersonaId, countMemories, getMemoryTitles, deleteMemory, updateMemory,
  getFileSummaryTitles,
  setUserLocale, getUserLocale,  createEmotionSnapshot, getEmotionSnapshots, getEmotionReport, getTodaySnapshot,
  getCollectedMessagesForPersona, getCollectedMessageSources,
  getIntimacyData, updateIntimacy,
  getMessageVolume, getEmotionTimeline, getPersonaEngagement, getHourlyDistribution, getAnalyticsStats,
  createDiaryEntry, getDiaryEntries, getDiaryByDate, deleteDiaryEntry, getMessagesByDate, getDiaryDates,
  getScenes, getSceneById, createScene, deleteScene, activateScene,
  getExportData, getRecentEmotionTrend, getMessageCountInRange, setGraduationStatus,
  countCollectedMessagesForPersona,
  getSafetyEvents, resolveSafetyEvent, getLatestGraduationAssessment, getLatestGraduationAssessments,
  getChannelBindingsByUserId, getChannelBinding, setChannelBindingPersona,
  getChannelDefaultPersona, setChannelDefaultPersona,
  deleteChannelBinding, getChannelState, upsertChannelState,
  getUserTemplates, createUserTemplate, updateUserTemplate, deleteUserTemplate,
  createQuestionnaireAnswers, getActiveReminders, dismissReminder,
  appendPersonaCorrection,
  upsertUserMood, getUserMoods,
  createLetter, getLetters, countLetters, getDueLetters, getLastLetterReplyAt,
  answerLetter, markLetterUnanswered, deleteLetter, getWaitingNotes, countWaitingNotes,
  createRelationshipEvent, getRelationshipEvents, deleteRelationshipEvent,
  saveEvalCases, getEvalCases, saveEvalRun, getLatestEvalRun,
  getOutboundLetters, setOutboundLetterStatus, updateOutboundLetterText,
  markOutboundLetterStaleNotified,
  createOutboundLetter,
  getCollectedMessagesForPersona as getCollectedMessagesForPersonaRows,
  getEvalRuns,
  setPersonaBehaviorProfile, getPersonaBehaviorProfile,
  createSafetyEvent, countSafetyEvents,
} from "./db";
import { nanoid } from "nanoid";
import path from "path";
import { getBotStatus, startWeChatBot, stopWeChatBot, startLogin, submitVerifyCode, cancelLogin } from "./wechat/bot";
import { clearAllActivePersonas } from "./wechat/commands";
import { runSkillPipeline } from "./skill-engine/pipeline";
import { exportSkillToHost } from "./skill-engine/skill-export";
import { getEmotionalStateDesc, buildSystemPrompt, computeIntimacy, checkGraduationEligibility } from "./_core/persona-utils";
import { isEmotionalState } from "./_core/emotion";
import { getEffectiveGraduationMode, getGraduationModeDetails, canOfferGraduation, getEffectivePresence } from "./_core/graduation";
import type { personas as personasTable } from "../drizzle/schema";
import type { DistillationMode } from "@shared/distillation-modes";
import { INTIMACY_LEVELS } from "@shared/intimacy";
import { getCrisisResources } from "./safety/resources";
import {
  zonedNoonForDayKey,
  isRealDayKey,
  isRealStartKey,
  isValidTimeZone,
  previousDateKey,
  zonedDateKey,
} from "@shared/timezone";
import { resolveRelationshipPhase, parseRecalledIds } from "@shared/user-side";
import { copy, localizeScene } from "@shared/copy";
import { buildEvalCases, casesFromRows, trainingTexts } from "./eval/dataset";
import { runEval } from "./eval/run";
import { collectOutboundCandidates } from "./chat/outbound";
import { measureAndSaveBehaviorProfile } from "./_core/behavior-profile";
import { mineMicroRules } from "./skill-engine/micro-rules";
import { normalizeBehaviorProfile } from "@shared/behavior-profile";
import { normalizeMicroRules } from "@shared/micro-rules";
import {
  normalizeImperfectionProfile,
  mergeImperfectionDefaults,
} from "@shared/imperfection";
import { mayReachOut } from "@shared/graduation-mode";
import { hashPassword, verifyPassword } from "./_core/password";
import { extractJsonArray, extractJsonObject } from "./_core/json";
import {
  runConversation,
  withPersonaTurn,
  PersonaAsleepError,
  clampContextLimit,
  clampTemperature,
  clampMaxTokens,
  sanitizeExtraConfig,
} from "./chat/service";
import { writeFarewellLetterWithStatus } from "./chat/farewell";
import { writeLetter } from "./chat/letters";
import { encryptSecret } from "./_core/crypto";
import { RATE_LIMITS } from "./_core/rate-limit";
import { sanitizeFileName, checkFileExtension } from "./_core/filename";
import { getSetupStatus } from "./bootstrap/setup-status";
import { getChannelAdapter, listChannels, stopChannelsForUser } from "./channels";
import { channelLabel } from "./channels/types";
import { feishuAdapter } from "./channels/feishu";
import { getBuiltinTemplates } from "./templates";
import { normalizeTemplate, validateTemplate, type PersonaTemplate } from "./templates/schema";
import { buildPersonaFromAnswers } from "./templates/questionnaire";
import { sourceLabel } from "./collectors/types";
import {
  personaDataToCard,
  cardToNormalizedPersona,
  cardToPersonaImport,
} from "./persona-cards/mapping";
import { readCardFromPng, writeCardToPng } from "./persona-cards/card";
import { resolveDefaultIconPath } from "./persona-cards/png";
import { resolveStoredPath } from "./storage";
import { applyPersonaCorrection, buildCorrectionLog } from "./skill-engine/correction";
import {
  COLLECTOR_SOURCES,
  CollectorQueueFullError,
  cancelCollectorJob,
  enqueueCollectorJob,
  getCollector,
  getCollectorJob,
  listCollectorJobs,
} from "./collectors";
import { listPersistedCollectorJobs, getPersistedCollectorJob, collectedSpeaker } from "./collectors/db-store";

/**
 * Resolves a persona's picture to PNG bytes for the character-card export.
 *
 * A persona without a picture gets the application's own icon, so the card
 * is always a valid image.
 */
async function resolveAvatarImage(avatarUrl: string | null): Promise<Buffer> {
  if (avatarUrl) {
    const key = avatarUrl.replace(/^\/uploads\//, "");
    const filePath = resolveStoredPath(key);
    if (filePath) {
      try {
        const { readFile } = await import("fs/promises");
        const buffer = await readFile(filePath);
        if (buffer.length > 0 && buffer.subarray(1, 4).toString() === "PNG") {
          return buffer;
        }
      } catch {
        // Fall through to the default icon.
      }
    }
  }

  const { readFile } = await import("fs/promises");
  // The icon path is resolved from the module location first, so a server
  // that does not run from the repository root still finds it.
  const iconPath = resolveDefaultIconPath();
  try {
    if (!iconPath) throw new Error("no icon found");
    return await readFile(iconPath);
  } catch {
    // A minimal valid PNG, so the export never fails outright.
    return Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
  }
}

/**
 * The largest upload accepted, in bytes.
 *
 * Matches the 50 MB JSON body limit the server is configured with.
 */
/**
 * The evaluation runs that are in flight.
 *
 * A run is up to twelve model calls, and the rate limit allows ten a
 * minute — so a double click started two runs, wrote two rows, and
 * left the comparison with the last run depending on which of them
 * finished last.
 */
const runningEvals = new Set<string>();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * The largest picture and the largest voice note a chat message may carry.
 *
 * These are much smaller than the generic upload limit: a phone photo is
 * a few megabytes and a voice note is smaller still, so fifty megabytes
 * is room for a file nobody sends. The limit exists because the payload
 * is base64 in a JSON body — it is read into memory, decoded, and written
 * to the uploads directory, and nothing ever cleaned that directory up.
 */
const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_BYTES = 25 * 1024 * 1024;

/** How many base64 characters carry a given number of bytes. */
function base64CharsFor(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

const MAX_BASE64_IMAGE_CHARS = base64CharsFor(MAX_IMAGE_UPLOAD_BYTES);
const MAX_BASE64_AUDIO_CHARS = base64CharsFor(MAX_AUDIO_UPLOAD_BYTES);

/**
 * How much of an uploaded chat log is kept as text.
 *
 * A chat log is the material the persona is made of, so this is generous:
 * half a million characters is a very long conversation, and the
 * distillation presets only read the first few tens of thousands of them
 * in any case.
 */
const MAX_EXTRACTED_CHARS = 500_000;

/**
 * How much transcript is handed to the distillation pipeline at once.
 *
 * The pipeline samples from the beginning of what it is given, so this
 * bound is about memory, not about quality.
 */
const MAX_DISTILLATION_CHARS = 1_000_000;

/**
 * The lock that guards a persona's own data.
 *
 * The persona's fields are one JSON column. So every write to them is a
 * read of the whole column, a change to one part of it, and a write of
 * the whole column back — and two of those that overlap lose one of the
 * two changes.
 *
 * They used to take different locks, or none at all: the mining and
 * the saving of the rules shared one, and the correction and the
 * imperfection profile had none. So mining the rules while the user
 * saved an imperfection profile wrote the profile away, and the user
 * was told it had been saved.
 *
 * They all take the same lock now, so they take turns.
 */
function withPersonaDataLock<T>(personaId: number, work: () => Promise<T>): Promise<T> {
  return withKeyLock(`persona-data:${personaId}`, work);
}

/**
 * The material a distillation reads.
 *
 * It is read once and handed to the run, because the extracted text of
 * the uploaded files is the largest thing the app holds for one
 * persona — half a million characters a file — and reading it twice
 * for one run is reading it twice for nothing.
 */
type DistillationMaterial = {
  files: Awaited<ReturnType<typeof getFilesByPersonaId>>;
  collected: Awaited<ReturnType<typeof getCollectedMessagesForPersona>>;
};

/**
 * The material for a persona: the uploaded files and the collected
 * messages.
 */
async function readDistillationMaterial(
  personaId: number,
  userId: number,
): Promise<DistillationMaterial> {
  const files = await getFilesByPersonaId(personaId, userId, {
    withExtractedMemory: true,
  });
  const collected = await getCollectedMessagesForPersona(personaId, userId);
  return { files, collected };
}

/**
 * Whether there is anything at all to distil.
 *
 * The pipeline can run on nothing: it then writes a person the model
 * invented over the person the user built by hand — the name stays, so
 * nothing looks wrong, and the personality, the memories and the
 * catchphrases are the model's.
 *
 * The check has to be in front of *both* entry points — the upload
 * page's "re-analyse" and the settings page's "import into the
 * persona" — because a guard that lands on one of them leaves the
 * other as a way to lose a persona.
 */
function hasDistillationMaterial(material: DistillationMaterial): boolean {
  const uploadedText = material.files
    .filter((f) => f.fileType === "chat_txt" || f.fileType === "chat_csv")
    .map((f) => f.extractedMemory || "")
    .join("\n")
    .trim();
  const hasPhotos = material.files.some((f) => f.fileType === "image" && f.fileUrl);
  return Boolean(uploadedText) || hasPhotos || material.collected.length > 0;
}

/**
 * Collects the uploaded material for a persona and kicks off the distillation
 * pipeline. Both `persona.triggerAnalysis` and `skillEngine.startPipeline`
 * route through here so there is a single persona-building path.
 */
async function startPersonaDistillation(params: {
  personaId: number;
  userId: number;
  name: string;
  characterFamily: "colleague" | "relationship" | "celebrity";
  /**
   * The celebrity research profile, e.g. "budget-unfriendly".
   *
   * Without it the celebrity family falls back to the ordinary three-stage
   * build, and the four research stages never run.
   */
  researchProfile?: string | null;
  /**
   * The named preset for this run.
   *
   * When it is given it decides the family, the research profile and the
   * depth knobs; the two arguments above are then ignored. A caller that
   * does not name a preset keeps the historical behaviour.
   */
  mode?: DistillationMode | null;
  /** The language the status messages are written in. */
  locale?: "zh" | "en";
  /**
   * The provider this persona is pinned to.
   *
   * It was never passed — so the pipeline fell back to the user's
   * *default* row, and a persona set to a local model (for privacy)
   * was distilled with a different service than the one the user chose
   * for it. The material went somewhere else.
   */
  provider?: string;
  /**
   * The material, read by the caller.
   *
   * The caller has to read it anyway — to decide whether there is
   * anything to distil — so it is handed over rather than read twice.
   */
  material?: DistillationMaterial;
}): Promise<void> {
  const { personaId, userId, name } = params;
  const locale = params.locale ?? "zh";

  /**
   * One run at a time per persona.
   *
   * Two runs could be started at once: a double click, two tabs, or an
   * API client. The user paid twice for the model calls, and — the
   * worse half — the run that finished *last* wrote the persona, so a
   * re-run could be replaced by the older analysis.
   */
  if (runningDistillations.has(personaId)) {
    console.warn(
      `[SkillEngine] A distillation for persona ${personaId} is already running.`,
    );
    return;
  }
  runningDistillations.add(personaId);

  try {
    // The distillation needs the extracted text of every file.
    const material = params.material ?? (await readDistillationMaterial(personaId, userId));
    const files = material.files;
    const chatContent = files
      .filter((f) => f.fileType === "chat_txt" || f.fileType === "chat_csv")
      .map((f) => f.extractedMemory || "")
      .join("\n\n---\n\n")
      .slice(0, MAX_DISTILLATION_CHARS);
    const imageUrls = files
      .filter((f) => f.fileType === "image")
      .map((f) => f.fileUrl)
      .filter(Boolean);

    // Messages pulled in by the collectors are part of the history too.
    const collected = material.collected;
    /**
     * The collected transcript has a ceiling too.
     *
     * The one-megabyte slice was applied to the *uploaded* files only.
     * So the material handed to the pipeline was that megabyte plus
     * the whole collected history — up to twenty thousand rows — and a
     * collector with a lot to say made the request enormous, and slow,
     * and expensive.
     */
    const collectedTranscript = collected.length > 0
      ? collected
          .map((m) => `${collectedSpeaker(m.role, locale)}${m.content}`)
          .join("\n")
          .slice(0, MAX_DISTILLATION_CHARS)
      : "";

    /**
     * Nothing to read.
     *
     * The pipeline runs on empty material and invents a person — and
     * then writes that person over the one the user built. Both entry
     * points check for material before they get here; this is the
     * net under them, because the check is a database read and the
     * material can be deleted between the check and the run.
     */
    if (!chatContent && imageUrls.length === 0 && !collectedTranscript) {
      console.warn(
        `[SkillEngine] Persona ${personaId} has no material to distil — nothing was written.`,
      );
      return;
    }

    await updatePersona(personaId, userId, {
      analysisStatus: "analyzing",
      analysisProgress: 5,
      analysisMessage: copy(locale, "persona.analysisStarting"),
    });

    await runSkillPipeline({
      personaId,
      userId,
      // The family and the profile are only used when the caller did not
      // name a preset; the pipeline resolves the preset first.
      characterFamily: params.characterFamily,
      name,
      chatContent: [chatContent, collectedTranscript].filter(Boolean).join("\n\n---\n\n"),
      imageUrls,
      researchProfile: params.researchProfile ?? undefined,
      mode: params.mode ?? undefined,
      // The persona's own provider — the one the user chose for it.
      provider: params.provider,
      // The prompts and the progress messages are written in the language
      // the person is using.
      locale,
    });
  } catch (e) {
    // The persona must never be left stuck in "pending" — the upload page
    // only surfaces progress for "analyzing" and errors for "error".
    console.error("[Persona] Distillation failed to start:", e);
    /**
     * The write that unsticks the persona is not allowed to fail
     * quietly.
     *
     * It used to be swallowed — so if the database was having a bad
     * moment, the persona was left at "analyzing" and the upload page
     * showed a spinner that never resolved. The persona could never be
     * talked to again, and the user had no way out.
     */
    try {
      await updatePersona(personaId, userId, {
        analysisStatus: "error",
        analysisMessage: copy(locale, "persona.analysisFailed"),
      });
    } catch (writeError) {
      console.error(
        "[Persona] Could not mark the distillation as failed:",
        (writeError as Error).message,
      );
    }
  } finally {
    runningDistillations.delete(personaId);
  }
}

/**
 * The personas whose distillation is running.
 *
 * It lives in this process: two instances of the app would each have
 * their own, and the database's own state is the one that is shared.
 */
const runningDistillations = new Set<number>();

/**
 * Rejects a provider name that is not registered.
 *
 * A typo would otherwise be stored silently, and every later chat would
 * quietly fall back to a different provider — the user would be talking to
 * a model they never chose. A custom endpoint is expressed by pointing a
 * registered provider (OpenAI, for instance) at a different `baseUrl`.
 */
/**
 * Whether a string is a date a memory can carry.
 *
 * A memory's date is either a whole day — "2026-02-14" — or a month
 * and a day, for a yearly anniversary — "02-14".
 *
 * It used to be any string at all, up to fifty characters. So "sometime
 * last summer" was stored as a date: the anniversary sweep compares
 * the month and the day, so the anniversary was never announced, and
 * nothing ever said that the date could not be read.
 */
function isMemoryDate(value: string): boolean {
  const trimmed = value.trim();
  if (isRealDayKey(trimmed)) return true;
  const match = /^(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // The last day of that month. `Date.UTC` counts the month from zero,
  // and a day of zero is the last day of the month before — which is
  // the month we want.
  const lastDay = new Date(Date.UTC(2000, month, 0)).getUTCDate();
  return day <= lastDay;
}

function assertKnownProvider(providerName: string, locale: "zh" | "en" = "zh"): void {
  const known = registry.list().map((p) => p.name.toLowerCase());
  if (known.includes(providerName.trim().toLowerCase())) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: copy(locale, "errors.unknownProvider", { provider: providerName }),
  });
}

/**
 * Noon on a day, in the user's own time zone.
 *
 * A day the user typed is a calendar day, not an instant — so it is
 * filed at the middle of that day *where they are*, and the interface
 * (which renders it in the reader's own zone) shows the day they meant.
 */
function noonInTheUsersZone(dayKey: string, timezone: string | null | undefined): Date {
  /**
   * The middle of the day, in the user's own zone.
   *
   * It used to be the middle of the day shifted by the difference
   * between the user's offset and the *server's* — so on a server that
   * is not on UTC the day was filed at the wrong hour of the user's
   * day, and the interface showed the day they meant at the wrong time.
   *
   * The instant is what matters: the driver writes it as the server's
   * own wall clock, and the interface renders it in the reader's zone.
   */
  return zonedNoonForDayKey(dayKey, timezone);
}

export const appRouter = router({
  system: systemRouter,

  /**
   * A public probe used by the first-run wizard.
   *
   * It is public, but the context still knows who is asking when the
   * request carries a session — so the answer can say "you have a
   * provider of your own", which is the difference between the wizard
   * and a usable app.
   */
  setup: publicProcedure.query(({ ctx }) => getSetupStatus(ctx.user?.id ?? null)),

  auth: router({
    // Never return the raw user row: it carries `passwordHash` and `openId`.
    me: publicProcedure.query(({ ctx }) => {
      if (!ctx.user) return null;
      return {
        id: ctx.user.id,
        username: ctx.user.username,
        name: ctx.user.name,
        email: ctx.user.email,
        role: ctx.user.role,
        loginMethod: ctx.user.loginMethod,
        createdAt: ctx.user.createdAt,
        lastSignedIn: ctx.user.lastSignedIn,
        // The user's own clock, so the client can keep it in step with the
        // browser's.
        timezone: ctx.user.timezone,
      };
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      // Bumping the token version retires every session this user holds, not
      // just the browser that made the request.
      if (ctx.user) {
        try {
          await bumpUserTokenVersion(ctx.user.id);
        } catch (e) {
          console.warn("[Auth] Failed to bump token version on logout:", e);
        }
      }
      return { success: true } as const;
    }),
  }),

  user: router({
    /**
     * Remembers the language the user reads.
     *
     * The interface sends it on every request, but the things the app
     * sends on its own — a reminder at midnight, a reply in a chat
     * window — have to know it without being asked.
     */
    setLocale: protectedProcedure
      .input(z.object({ locale: z.enum(["zh", "en"]) }))
      .mutation(async ({ ctx, input }) => {
        await setUserLocale(ctx.user.id, input.locale);
        return { success: true };
      }),

    getProfile: protectedProcedure.query(async ({ ctx }) => {
      const user = await getUserById(ctx.user.id);
      /**
       * The session is valid but the user is gone.
       *
       * It happens: the account is deleted on another device, or the
       * database is restored from a backup taken before it existed. The
       * message says what happened instead of the bare "not found" the
       * interface would have shown for a missing page.
       */
      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: copy(ctx.locale, "errors.userNotFound") });
      }
      return {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        loginMethod: user.loginMethod,
        createdAt: user.createdAt,
        lastSignedIn: user.lastSignedIn,
        // The instance-wide default for the graduation mechanism. The
        // client needs it to show what a persona that inherits the default
        // will actually do.
        graduationMode: user.graduationMode,
        // The user's own clock, so the app can greet them in their morning.
        timezone: user.timezone,
        // How the user wants to be addressed, and what they would rather
        // the persona did not bring up.
        addressStyle: user.addressStyle,
        boundaries: user.boundaries,
        // Whether the app may read the user's own messages to assess
        // their emotional trajectory.
        trajectoryAssessment: user.trajectoryAssessment,
      };
    }),

    /**
     * Sets whether the app may read the user's own messages.
     *
     * The trajectory assessment is the one place where the app sends a
     * month of raw private conversation to the model. "auto" runs it when
     * the graduation mechanism is in its suggesting mode; "on" and "off"
     * are the user's own decision.
     */
    updateTrajectoryAssessment: protectedProcedure
      .input(z.object({ setting: z.enum(["auto", "on", "off"]) }))
      .mutation(async ({ ctx, input }) => {
        await updateUserTrajectoryAssessment(ctx.user.id, input.setting);
        return { success: true };
      }),

    /**
     * How the user has been doing.
     *
     * The app inferred the persona's mood from the conversation and charted
     * it on the user's own dashboard. These are the user's own states,
     * recorded by the user — one entry per day, and checking in again
     * replaces the day's entry.
     */
    setMood: protectedProcedure
      .input(z.object({
        mood: z.enum(["great", "okay", "low", "down", "anxious", "numb"]),
        note: z.string().max(280).optional(),
        /** The day, as "YYYY-MM-DD" in the user's own time zone. */
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const date = input.date ?? zonedDateKey(new Date(), ctx.user.timezone);
        /**
         * The date is a real day.
         *
         * It was only checked against a pattern, so "9999-99-99" and
         * "2026-02-30" were accepted and stored — and then the day
         * could never be a day the chart could show.
         */
        if (!isRealDayKey(date)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.invalidDateFormat") });
        }
        const mood = await upsertUserMood({
          userId: ctx.user.id,
          date,
          mood: input.mood,
          note: input.note ?? null,
        });

        /**
         * The note is scanned.
         *
         * The mood check-in is the one place the app asks the person
         * how they are — and the note was the only place the user
         * could write freely that was *not* read by the crisis
         * detector. So a person who wrote "我不想活了" into the
         * "how are you today" box got a warm reply and no support
         * resources at all.
         */
        const crisis = input.note ? detectCrisis(input.note) : null;
        if (crisis?.crisis) {
          await createSafetyEvent({
            userId: ctx.user.id,
            personaId: null,
            type: "crisis",
            severity: "critical",
          }).catch((e: unknown) => console.warn("[Safety] Failed to record the crisis event:", e));
          return { success: true, mood, crisis: true };
        }
        return { success: true, mood, crisis: false };
      }),

    /** The user's own moods, oldest first. */
    moods: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).optional() }))
      .query(async ({ ctx, input }) => {
        return getUserMoods(ctx.user.id, input.days ?? 30, ctx.user.timezone);
      }),

    /**
     * Sets the instance-wide default for the graduation mechanism.
     *
     * A persona that has its own setting keeps it; the ones that inherit
     * follow this value.
     */
    updateGraduationMode: protectedProcedure
      .input(z.object({ mode: z.enum(["suggest", "manual", "off"]) }))
      .mutation(async ({ ctx, input }) => {
        await updateUserGraduationMode(ctx.user.id, input.mode);
        return { success: true };
      }),

    updateProfile: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(100).optional(),
        /**
         * The user's own address.
         *
         * `null` takes it away. It used to be optional only, and
         * `undefined` means "leave it alone" — so an empty field could
         * never clear the address, and there was no other way to remove
         * it.
         */
        email: z.string().email().max(320).nullable().optional(),
        /**
         * The user's own time zone, as an IANA name.
         *
         * The client sends what the browser reports. It is used for the
         * user's own clock — "good morning" has to mean the user's morning
         * — and as the default for a persona that has no zone of its own.
         */
        timezone: z.string().max(64).nullable().optional(),
        /**
         * How the user wants to be addressed.
         *
         * The persona knows how the other person talks. It had no idea how
         * the user wants to be called.
         */
        addressStyle: z.string().max(64).nullable().optional(),
        /**
         * What the persona should not bring up.
         *
         * A line the user can draw, which the persona is told about and
         * respects.
         */
        boundaries: z.string().max(500).nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.timezone !== undefined && input.timezone && !isValidTimeZone(input.timezone)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.unknownTimezone") });
        }
        await updateUserProfile(ctx.user.id, input);
        return { success: true };
      }),

    changePassword: protectedProcedure
      .input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6).max(128) }))
      .mutation(async ({ ctx, input }) => {
        const user = await getUserById(ctx.user.id);
        if (!user || !user.passwordHash) throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.cannotChangePassword") });
        const valid = await verifyPassword(input.currentPassword, user.passwordHash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: copy(ctx.locale, "errors.currentPasswordWrong") });
        await updateUserPassword(ctx.user.id, await hashPassword(input.newPassword));
        /**
         * A password change signs every other device out — and keeps this
         * one in.
         *
         * The token version was bumped and nothing else: so the token the
         * browser was holding was retired along with everyone else's, and
         * the person who had just changed their password was signed out
         * of the tab they changed it in — with the new password already
         * in hand and no way to tell that from a failure.
         *
         * So the version is bumped (every other token is retired) and a
         * fresh token is minted for this device with the new version.
         */
        await bumpUserTokenVersion(ctx.user.id);
        const fresh = await getUserById(ctx.user.id);
        const token = await createSessionToken(
          ctx.user.id,
          fresh?.name || ctx.user.name || user.name || user.username,
          fresh?.tokenVersion ?? (ctx.user.tokenVersion ?? 0) + 1,
        );
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        return { success: true };
      }),

    getAccountStats: protectedProcedure.query(async ({ ctx }) => getAccountStats(ctx.user.id)),

    exportData: protectedProcedure.mutation(async ({ ctx }) => {
      const data = await exportUserData(ctx.user.id);
      return data;
    }),

    deleteAccount: protectedProcedure
      .input(z.object({ confirmPassword: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const user = await getUserById(ctx.user.id);
        if (!user || !user.passwordHash) throw new TRPCError({ code: "BAD_REQUEST" });
        const valid = await verifyPassword(input.confirmPassword, user.passwordHash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: copy(ctx.locale, "errors.passwordWrong") });
        /**
         * The channels are stopped first.
         *
         * Deleting the rows does not stop the WeChat poll loop or the
         * Feishu long connection — they keep running until they are
         * told to stop. So the bot went on answering on WeChat for an
         * account that no longer existed, the person on the other end
         * was told to go and set a persona in the web app, and the
         * messages it wrote carried a user id that no longer had a
         * user — so the later clean-up never found them.
         */
        await stopChannelsForUser(ctx.user.id);
        await deleteUserAccount(ctx.user.id);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
        return { success: true };
      }),
  }),

  persona: router({
    list: protectedProcedure.query(async ({ ctx }) => getPersonasWithStats(ctx.user.id)),

    stats: protectedProcedure.query(async ({ ctx }) => getUserStats(ctx.user.id, ctx.user.timezone)),

    recentActivity: protectedProcedure.query(async ({ ctx }) => getRecentActivity(ctx.user.id)),

    dailyActivity: protectedProcedure.query(async ({ ctx }) => getDailyChatCounts(ctx.user.id, 30, ctx.user.timezone)),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return persona;
      }),

    /**
     * Creates a persona from the guided questionnaire.
     *
     * This is the path for people who have no chat logs to upload — the
     * answers are mapped onto the same persona structure the distillation
     * pipeline produces.
     */
    createFromQuestionnaire: protectedProcedure
      .input(z.object({
        answers: z.object({
          name: z.string().max(100).optional(),
          relationship: z.string().max(200).optional(),
          togetherFrom: z.string().max(50).optional(),
          metStory: z.string().max(4000).optional(),
          communicationStyles: z.array(z.string().max(50)).max(10).optional(),
          catchphrases: z.array(z.string().max(50)).max(20).optional(),
          caresAbout: z.string().max(2000).optional(),
          conflictStyle: z.string().max(50).optional(),
          loveLanguage: z.string().max(50).optional(),
          boundaries: z.string().max(2000).optional(),
          nickname: z.string().max(50).optional(),
          notes: z.string().max(2000).optional(),
        }),
      }))
      .mutation(async ({ ctx, input }) => {
        const result = buildPersonaFromAnswers(input.answers, ctx.locale);

        const personaId = await createPersona({
          userId: ctx.user.id,
          name: result.name,
          relationshipDesc: result.relationshipDesc,
          togetherFrom: result.togetherFrom,
          togetherTo: null,
          personaData: result.personaData as any,
          source: "questionnaire",
          analysisStatus: "ready",
          analysisProgress: 100,
          analysisMessage: copy(ctx.locale, "persona.fromQuestionnaire"),
        });

        await createQuestionnaireAnswers({
          personaId,
          userId: ctx.user.id,
          answers: input.answers as any,
        });

        return { personaId };
      }),

    /**
     * Creates a persona the user can talk to right now.
     *
     * The first thing the app asked for was somebody else's chat history.
     * That is the single biggest barrier in front of the product: you have
     * to go and find a file, and most people never get that far.
     *
     * A sandbox persona is one of the built-in characters, ready to talk
     * with no upload at all. It is a place to try the product out, and it
     * can be replaced later by a real one distilled from real logs.
     */
    createSandbox: protectedProcedure
      .input(z.object({ templateId: z.string().min(1).optional() }))
      .mutation(async ({ ctx, input }) => {
        const builtins = getBuiltinTemplates();
        const template =
          builtins.find((t) => t.id === input.templateId) ??
          builtins.find((t) => t.family === "relationship") ??
          builtins[0];
        if (!template) throw new TRPCError({ code: "NOT_FOUND" });

        const personaId = await createPersona({
          userId: ctx.user.id,
          name: template.name,
          relationshipDesc: template.description ?? null,
          togetherFrom: null,
          togetherTo: null,
          personaData: template.personaData as any,
          analysisStatus: "ready",
          analysisProgress: 100,
          analysisMessage: copy(ctx.locale, "persona.example"),
          source: "sandbox",
        });
        return { personaId, name: template.name };
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(100),
        relationshipDesc: z.string().max(200).optional(),
        /**
         * The start of the relationship.
         *
         * It was any string of up to fifty characters — so "去年" was
         * stored, and the card then said "together for 1 day" and "today
         * is the anniversary!", both of them false.
         *
         * A month key ("2021-05") or a day key ("2021-05-20") is
         * accepted; both are what the app asks for.
         */
        togetherFrom: z.string().max(50).refine(isRealStartKey, {
          message: "Not a date.",
        }).optional(),
        togetherTo: z.string().max(50).refine(isRealStartKey, {
          message: "Not a date.",
        }).optional(),
        // Where the persona came from. "upload" is the default — the persona
        // is built from uploaded chat logs.
        source: z.enum(["upload", "questionnaire", "card", "sandbox"]).default("upload"),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await createPersona({ userId: ctx.user.id, ...input, analysisStatus: "pending" });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        relationshipDesc: z.string().max(200).optional(),
        /**
         * Nullable, so a field can be cleared.
         *
         * Drizzle ignores `undefined` in an update, so an emptied field
         * was silently dropped and the old value stayed: the user
         * cleared the date, pressed save, saw the success toast, and
         * the date was back.
         */
        /**
         * The dates of the relationship, and the same check the create
         * path has.
         *
         * "去年" was stored as it was typed, and the card then said
         * "together for 1 day" and "today is the anniversary" — both of
         * them false. The create path refuses it; this one did not, so
         * an API caller could put it back.
         */
        togetherFrom: z.string().max(50).nullable().optional().refine(
          (value) => value === null || value === undefined || isRealStartKey(value),
          { message: "Not a date." },
        ),
        togetherTo: z.string().max(50).nullable().optional().refine(
          (value) => value === null || value === undefined || isRealStartKey(value),
          { message: "Not a date." },
        ),
        emotionalState: z.enum(["warm","playful","nostalgic","melancholy","happy","distant"]).optional(),
        llmProvider: z.string().max(64).nullable().optional(),
        remindersEnabled: z.boolean().optional(),
        /**
         * This persona's graduation mode. Null means "inherit the user's
         * instance default" — which is why null is a value here and not
         * merely "not given".
         */
        graduationMode: z.enum(["suggest", "manual", "off"]).nullable().optional(),
        /** The distillation preset a re-run should use. */
        distillationMode: z.enum(["fast", "standard", "deep", "colleague", "celebrity"]).nullable().optional(),
        /**
         * Where this persona lives, as an IANA time zone name.
         *
         * The persona's sense of time is computed in their own zone, not the
         * server's — which matters for anyone whose partner is abroad.
         */
        timezone: z.string().max(64).nullable().optional(),
        /**
         * Whether the app may reach out about this persona.
         *
         * "quiet" is the user asking for some space. It is separate from
         * the graduation ritual, which records whether the goodbye has
         * happened.
         */
        presence: z.enum(["active", "quiet", "asleep"]).optional(),
        /**
         * Whether the two of them can currently reach each other.
         *
         * A distance is not a breakup, and the app had no way to say so.
         */
        reachability: z.enum(["reachable", "unreachable"]).optional(),
        /** Pinned personas sit at the top of the lobby. */
        isPinned: z.boolean().optional(),
        /**
         * How often the persona may start a conversation on its own, in
         * hours. Zero means never — and zero is the default, because an
         * app that speaks first is something the user has to buy.
         */
        proactiveFrequencyHours: z.number().int().min(0).max(720).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...rest } = input;
        // A persona that points at a provider that does not exist would
        // silently talk to a different model.
        if (rest.llmProvider) assertKnownProvider(rest.llmProvider, ctx.locale);
        // Drizzle ignores undefined values in an update, so the two settings
        // that can be cleared are only written when they were actually sent.
        const data: Partial<typeof personasTable.$inferInsert> = {
          name: rest.name,
          relationshipDesc: rest.relationshipDesc,
          togetherFrom: rest.togetherFrom,
          togetherTo: rest.togetherTo,
          emotionalState: rest.emotionalState,
          llmProvider: rest.llmProvider,
          remindersEnabled: rest.remindersEnabled,
        };
        if (rest.graduationMode !== undefined) data.graduationMode = rest.graduationMode;
        if (rest.distillationMode !== undefined) data.distillationMode = rest.distillationMode;
        if (rest.timezone !== undefined) {
          if (rest.timezone && !isValidTimeZone(rest.timezone)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.unknownTimezone") });
          }
          data.timezone = rest.timezone;
        }
        if (rest.presence !== undefined) data.presence = rest.presence;
        if (rest.reachability !== undefined) data.reachability = rest.reachability;
        if (rest.isPinned !== undefined) data.isPinned = rest.isPinned;
        if (rest.proactiveFrequencyHours !== undefined) {
          data.proactiveFrequencyHours = rest.proactiveFrequencyHours;
        }
        /**
         * Did anything happen?
         *
         * Every sibling checks first — the delete, the persona's own
         * fields, the graduation — and this one did not. So a persona
         * that had been deleted in another tab, or a stale id in the
         * URL, answered "saved", and the field the user had just
         * changed was unchanged.
         */
        const written = await updatePersona(id, ctx.user.id, data);
        if (!written) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { success: true };
      }),

    updatePersonaData: protectedProcedure
      .input(z.object({
        id: z.number(),
        /**
         * The persona's own fields.
         *
         * Bounded: the record was accepted in any shape and any size,
         * and it is stored in one JSON column that every read of the
         * persona brings back — and that every prompt is built from.
         */
        personaData: z.record(z.string(), z.unknown()).refine(
          (value) => Object.keys(value).length <= 60 &&
            JSON.stringify(value).length <= 200_000,
          "The persona's fields are too large",
        ),
      }))
      .mutation(async ({ ctx, input }) => {
        // The persona's fields are one column, so this is a read and a
        // write of the whole thing — see `withPersonaDataLock`.
        return await withPersonaDataLock(input.id, async () => {
          const persona = await getPersonaById(input.id, ctx.user.id);
          if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
          const merged = { ...((persona.personaData as any) || {}), ...input.personaData };
          await updatePersona(input.id, ctx.user.id, { personaData: merged });
          return { success: true };
        });
      }),

    /**
     * The prompt the persona is actually given.
     *
     * It used to be the bare identity prompt — no memories, no anchors,
     * no summary, no 【关于对话者】 — so the prompt a user inspected was
     * not the prompt the model was working from. The person who wanted
     * to know what the app understood was shown a simplified version of
     * it, which is exactly the wrong thing to show them.
     */
    getSystemPrompt: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        const { buildPromptForPersona } = await import("./chat/prompt");
        /**
         * The prompt the model works from.
         *
         * The inspection used to build a *different* one: it forced the
         * language to Chinese, and it left out the scene's own wording
         * and the message being quoted. So the prompt the user read was
         * not the prompt the persona was given — and the docstring said
         * it was.
         */
        const scene = persona.activeSceneId
          ? await getSceneById(persona.activeSceneId, ctx.user.id).catch(() => null)
          : null;
        const prompt = await buildPromptForPersona({
          persona,
          userId: ctx.user.id,
          locale: ctx.locale,
          now: new Date(),
          // The scene's own wording goes into the prompt, so it has to be
          // in the language the persona is speaking.
          sceneOverlay: scene
            ? (localizeScene(scene as any, ctx.locale) as any).systemPromptOverlay ?? null
            : null,
          emotionalState: scene?.emotionalState && isEmotionalState(scene.emotionalState)
            ? scene.emotionalState
            : null,
          // This is a read. Marking the memories as recalled would halve
          // the weight of the user's own pinned memories and anchors for
          // a day — every time they opened the prompt.
          markRecalled: false,
        });
        return { prompt };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // Ownership is checked before the delete, so another user's persona
        // comes back as "not found" rather than being silently wiped.
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        await deletePersona(input.id, ctx.user.id);
        return { success: true };
      }),

    getIntimacy: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const data = await getIntimacyData(input.id, ctx.user.id);
        // Read-only: the score is persisted after each conversation turn, so
        // a query must not write.
        const result = computeIntimacy(data);
        const nextLevel = INTIMACY_LEVELS.find(l => l.threshold > result.score);
        return {
          ...result,
          breakdown: data,
          nextLevel: nextLevel?.name ?? null,
          nextLevelKey: nextLevel?.key ?? null,
          nextThreshold: nextLevel?.threshold ?? 1000,
        };
      }),

    /**
     * Applies a correction the user wrote about this persona.
     *
     * The correction prompt turns the note into a concrete patch on the
     * persona fields, and the change is recorded so it is auditable.
     */
    applyCorrection: protectedProcedure
      /**
       * The correction sends the persona's whole field set and the
       * user's own words to the provider, and it had no limit at all.
       * Every other procedure that calls a model has one.
       */
      .use(rateLimit(RATE_LIMITS.llm))
      .input(z.object({
        id: z.number(),
        correction: z.string().min(1).max(2000),
      }))
      .mutation(async ({ ctx, input }) => {
        // The persona's fields are one column, so this is a read and a
        // write of the whole thing — and the correction holds the row
        // across a model call — see `withPersonaDataLock`.
        return await withPersonaDataLock(input.id, async () => {
          const persona = await getPersonaById(input.id, ctx.user.id);
          if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
          if (!persona.personaData) {
            throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.personaNotAnalyzed") });
          }

          // The correction is a stage of its own: it changes the persona, and
          // a consumer of `skill_jobs.pipeline_stage` has to be able to see
          // that happening.
          const jobId = (persona as any).skillJobId ?? null;
          if (jobId) {
            await updateSkillJob(jobId, ctx.user.id, {
                pipelineStage: "correcting",
                stageMessage: copy(ctx.locale, "persona.updating"),
              })
              .catch(() => undefined);
          }

          /**
           * The user's own model service.
           *
           * The correction carries the persona's whole field set and the
           * user's own words. It was always sent to the operator's
           * account — the environment-configured provider — even when the
           * user had a key of their own.
           */
          const { provider: correctionProvider, owned: correctionOwned } =
            await resolveProviderForUserWithOwnership({
              userId: ctx.user.id,
              providerName: (persona as any).llmProvider || undefined,
            });

          const result = await applyPersonaCorrection({
            name: persona.name,
            characterFamily: "relationship",
            personaData: persona.personaData as any,
            correction: input.correction,
            provider: (persona as any).llmProvider || undefined,
            userProvider: correctionProvider,
            providerOwned: correctionOwned,
            locale: ctx.locale,
          });

          if (!result) {
            if (jobId) {
              await updateSkillJob(jobId, ctx.user.id, { pipelineStage: "complete" })
                .catch(() => undefined);
            }
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: copy(ctx.locale, "errors.correctionNotUnderstood"),
            });
          }

          if (result.needsClarification && result.question) {
            if (jobId) {
              await updateSkillJob(jobId, ctx.user.id, { pipelineStage: "complete" })
                .catch(() => undefined);
            }
            return {
              applied: false,
              question: result.question,
              changedFields: result.changedFields,
            };
          }

          /**
           * The correction is merged into the persona, not written over it.
           *
           * The normalised data carries the fields the correction knows
           * about. It does not carry `customInstructions` — the user's own
           * words to the persona — nor `starterQuestions`: they are not in
           * the type, so the normaliser drops them, and the whole blob was
           * replaced. So a correction silently deleted what the user had
           * written.
           */
          await updatePersona(input.id, ctx.user.id, {
            personaData: {
              ...((persona.personaData as any) || {}),
              ...(result.personaData as any),
            },
          });

          await appendPersonaCorrection(input.id, ctx.user.id, buildCorrectionLog({
            summary: result.summary,
            changedFields: result.changedFields,
            correction: input.correction,
          })).catch((e) => console.warn("[SkillEngine] Failed to log the correction:", e));

          if (jobId) {
            await updateSkillJob(jobId, ctx.user.id, { pipelineStage: "complete" })
              .catch(() => undefined);
          }

          return {
            applied: true,
            personaData: result.personaData,
            changedFields: result.changedFields,
            summary: result.summary,
          };
        });
      }),

    /** The correction history for a persona. */
    correctionLog: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return Array.isArray(persona.correctionLog) ? persona.correctionLog : [];
      }),

    getAnalysisStatus: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return {
          status: persona.analysisStatus,
          progress: persona.analysisProgress,
          message: persona.analysisMessage,
          /**
           * The id of the run in progress.
           *
           * The upload page read it from the *persona* — which is only
           * refetched when the run is over. So during the run the page
           * held the value from before: on a first run there was no job
           * at all, so the stage, the attempt number and the intake
           * gaps were never shown; and on a re-run the job id was the
           * *previous* run's, whose stage was already "complete" — so
           * the page showed the old run's stage for the whole duration
           * of the new one.
           */
          skillJobId: persona.skillJobId ?? null,
        };
      }),

    triggerAnalysis: protectedProcedure.use(rateLimit(RATE_LIMITS.llmHeavy))
      .input(z.object({
        id: z.number(),
        characterFamily: z.enum(["colleague", "relationship", "celebrity"]).default("relationship"),
        // Only meaningful for the celebrity family: the research profile
        // decides whether the four-stage research flow runs.
        researchProfile: z.enum(["budget-friendly", "budget-unfriendly"]).optional(),
        // The named preset. When it is given it decides the family, the
        // research profile and the depth of the run.
        mode: z.enum(["fast", "standard", "deep", "colleague", "celebrity"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        /**
         * There has to be something to read.
         *
         * A run with no material at all — no upload, no collection —
         * went through anyway: the model was asked to describe a
         * person it had heard nothing about, it invented one, and the
         * invention *replaced* the persona the user already had. So a
         * person who pressed "import into the persona" on a persona
         * with no material lost the personality they had built.
         */
        /**
         * One run at a time per persona — across every process.
         *
         * The guard was a set in one process's memory: two instances of
         * the app would each have their own, and the user paid twice
         * for the model calls — and the run that finished *last* wrote
         * the persona, so a re-run could be replaced by the older
         * analysis.
         *
         * The shared state is the persona's own row.
         */
        if (persona.analysisStatus === "analyzing") {
          const jobId = (persona as any).skillJobId ?? null;
          const job = jobId
            ? await getSkillJobById(jobId, ctx.user.id).catch(() => undefined)
            : undefined;
          // A run that was written to recently is alive. One that has
          // not been touched for a while belongs to a process that has
          // gone, and it must not block the user for ever.
          const alive = job
            ? Date.now() - new Date(job.updatedAt as Date).getTime() < 10 * 60_000
            : false;
          if (alive) {
            throw new TRPCError({
              code: "CONFLICT",
              message: copy(ctx.locale, "errors.distillationAlreadyRunning"),
            });
          }
        }

        const material = await readDistillationMaterial(input.id, ctx.user.id);
        if (!hasDistillationMaterial(material)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(ctx.locale, "errors.nothingToDistil"),
          });
        }
        startPersonaDistillation({
          locale: ctx.locale,
          personaId: input.id,
          // The provider the persona is pinned to — the chat path
          // honours it, and the distillation did not.
          provider: (persona as any).llmProvider ?? undefined,
          userId: ctx.user.id,
          name: persona.name,
          characterFamily: input.characterFamily,
          researchProfile: input.researchProfile ?? null,
          mode: input.mode ?? null,
          material,
        }).catch((e) => console.error("[triggerAnalysis] error:", e));
        return { success: true };
      }),

    /**
     * The graduation mode that applies to a persona.
     *
     * The client needs the effective mode to decide whether it may offer
     * the farewell itself, and the two stored values to show what the
     * persona inherits and what it overrides.
     */
    graduationMode: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getGraduationModeDetails({
          personaMode: persona.graduationMode,
          userId: ctx.user.id,
        });
      }),

    checkGraduation: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.graduationStatus === "graduated") {
          return { eligible: false, status: "graduated" as const, farewellLetter: persona.farewellLetter };
        }
        // An offer that was made — or refused — puts the persona in a
        // cooldown. During it the answer does not change; after it the
        // thresholds are consulted again, because a refusal has to be
        // revisable or it is a decision the user never gets to make.
        const offer = canOfferGraduation({
          status: persona.graduationStatus,
          suggestedAt: persona.graduationSuggestedAt,
          declinedAt: persona.graduationDeclinedAt,
        });
        if (!offer.allowed) {
          return {
            eligible: persona.graduationStatus === "suggested",
            status: (persona.graduationStatus || null) as string | null,
            reason: copy(
          ctx.locale,
          persona.graduationStatus === "declined"
            ? "graduation.statusAlreadyDeclined"
            : "graduation.statusAlreadySuggested",
        ),
            farewellLetter: null,
          };
        }
        // A persona the user asked to be left alone is not one to raise a
        // farewell with.
        const presence = getEffectivePresence({
          personaPresence: persona.presence,
          graduationStatus: persona.graduationStatus,
        });
        if (!mayReachOut(presence)) {
          return {
            eligible: false,
            status: (persona.graduationStatus || null) as string | null,
            reason: copy(ctx.locale, "graduation.statusQuiet"),
            farewellLetter: null,
          };
        }
        // The mode decides whether the app may raise the topic at all. In
        // "manual" the user starts it themselves; in "off" it is not
        // available — either way the thresholds are not the answer.
        const mode = await getEffectiveGraduationMode({
          personaMode: persona.graduationMode,
          userId: ctx.user.id,
        });
        if (mode === "off") {
          return {
            eligible: false,
            status: (persona.graduationStatus || null) as string | null,
            reason: copy(ctx.locale, "graduation.statusModeOff"),
            farewellLetter: null,
          };
        }
        if (mode === "manual") {
          return {
            eligible: false,
            status: (persona.graduationStatus || null) as string | null,
            reason: copy(ctx.locale, "graduation.statusManualOnly"),
            farewellLetter: null,
          };
        }
        const recentEmotions = await getRecentEmotionTrend(input.id, ctx.user.id, 14, ctx.user.timezone);
        const recentFreq = await getMessageCountInRange(input.id, ctx.user.id, 7, 0, ctx.user.timezone);
        const prevFreq = await getMessageCountInRange(input.id, ctx.user.id, 14, 7, ctx.user.timezone);
        const result = checkGraduationEligibility({
          intimacyLevel: persona.intimacyLevel,
          recentEmotions,
          chatCount: persona.chatCount,
          recentChatFrequency: recentFreq,
          previousChatFrequency: prevFreq,
          // The reason is read by a person. It has to be in their
          // language.
          locale: ctx.locale,
        });
        // A query does not write.
        //
        // It used to: when the thresholds were met it marked the persona
        // as "suggested". That is a `GET`, so it is not covered by the
        // origin check, it is cacheable by anything in between, and a
        // link prefetch or a crawler could trigger it — and the mark
        // starts a seven-day cooldown, so one stray prefetch could
        // suppress the very offer the user was about to see.
        //
        // The conversation pipeline marks it instead, which is where the
        // decision is actually made.
        return { eligible: result.eligible, status: (persona.graduationStatus || null) as string | null, reason: result.reason, farewellLetter: null };
      }),

    graduate: protectedProcedure
      .use(rateLimit(RATE_LIMITS.llmHeavy))
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        // "off" means the mechanism is switched off for this persona, so
        // there is no farewell letter to write. The other two modes welcome
        // it — in "manual" the thresholds do not apply, because the user has
        // already made the decision.
        const mode = await getEffectiveGraduationMode({
          personaMode: persona.graduationMode,
          userId: ctx.user.id,
        });
        if (mode === "off") {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.graduationModeOff") });
        }
        // The letter is written with the user's own provider, from the same
        // material the conversation would have had. Using the server's
        // provider meant that anyone who configured a key in the settings —
        // and only there — got an error at the one moment the product exists
        // for.
        const { letter: farewellLetter, degraded, draft } = await writeFarewellLetterWithStatus({
          persona,
          userId: ctx.user.id,
          locale: ctx.locale,
        });
        await setGraduationStatus(
          input.id,
          ctx.user.id,
          "graduated",
          farewellLetter,
          degraded,
          draft,
        );
        return { farewellLetter, degraded, draft };
      }),

    declineGraduation: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        /**
         * A persona that has already graduated cannot be declined.
         *
         * The letter is written and the graduation date is set before
         * the window is closed — and the window's escape key, its
         * backdrop and its ✕ all meant "decline". So one Escape keypress
         * after the most important moment of the product left the
         * persona in a contradictory state: declined, with a farewell
         * letter and a graduation date.
         *
         * It could not be un-graduated either — the "awaken" path
         * refuses a persona that is not graduated — and the farewell
         * could be offered again.
         */
        if (persona.graduationStatus === "graduated") {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.personaAlreadyGraduated") });
        }
        await setGraduationStatus(input.id, ctx.user.id, "declined");
        return { success: true };
      }),

    awaken: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.graduationStatus !== "graduated") throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.personaNotGraduated") });
        await setGraduationStatus(input.id, ctx.user.id, null);
        return { success: true };
      }),
  }),

  file: router({
    upload: protectedProcedure.use(rateLimit(RATE_LIMITS.upload))
      .input(z.object({
        personaId: z.number(),
        fileName: z.string().min(1).max(255),
        fileType: z.enum(["chat_txt", "chat_csv", "collected", "image", "video"]),
        fileSize: z.number().min(1).max(MAX_UPLOAD_BYTES),
        fileContent: z.string(),
        mimeType: z.string().max(128),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const buffer = Buffer.from(input.fileContent, "base64");
        // The declared size is a hint; the decoded bytes are the truth.
        if (buffer.length > MAX_UPLOAD_BYTES) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.fileTooLarge") });
        }
        const safeName = sanitizeFileName(input.fileName);
        const extensionProblem = checkFileExtension(safeName, input.fileType, ctx.locale);
        if (extensionProblem) {
          throw new TRPCError({ code: "BAD_REQUEST", message: extensionProblem });
        }
        const fileKey = `personas/${ctx.user.id}/${input.personaId}/${nanoid()}-${safeName}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        let extractedText: string | undefined;
        if (input.fileType === "chat_txt" || input.fileType === "chat_csv") {
          extractedText = buffer.toString("utf-8").slice(0, MAX_EXTRACTED_CHARS);
        } else if (input.fileType === "collected") {
          /**
           * A mail export is not text.
           *
           * It is read as text anyway — so the excerpt in the file list
           * is readable. A binary export produces mojibake, which is
           * better than nothing but is not what it looks like.
           */
          extractedText = buffer.toString("utf-8").slice(0, MAX_EXTRACTED_CHARS);
        }
        // The whole transcript is stored.
        //
        // It used to be sliced to two thousand characters here, which is
        // about forty lines of chat: the persona was distilled from the
        // first few messages of a long history and nothing said so. The
        // pipeline already decides how much of it to read — the presets
        // ask for up to thirty thousand characters — so the limit belongs
        // at the point of use, not on the way in.
        const fileId = await createPersonaFile({ personaId: input.personaId, userId: ctx.user.id, fileType: input.fileType, originalName: safeName, fileKey, fileUrl: url, fileSize: buffer.length, extractedMemory: extractedText, processStatus: "done" });
        return { fileId, fileUrl: url };
      }),

    list: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getFilesByPersonaId(input.personaId, ctx.user.id);
      }),
  }),

  chat: router({
    getHistory: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        limit: z.number().min(1).max(200).default(50),
        /** The id of the oldest message on screen; older ones come back. */
        before: z.number().optional(),
      }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const rows = input.before !== undefined
          ? await getMessagesBefore(input.personaId, ctx.user.id, input.before, input.limit)
          : await getMessagesByPersonaId(input.personaId, ctx.user.id, input.limit);

        // The memories each turn recalled, with their titles.
        const ids = rows.flatMap((m: any) => parseRecalledIds(m.recalledMemoryIds));
        const titles = await getMemoryTitles(ids, ctx.user.id);
        /**
         * The titles of the recalled file summaries.
         *
         * A file summary carries a negative id — it lives in another
         * table, and the negative id is what keeps the two apart. So
         * the memories table has no row for it, and the title was
         * empty: the "what did the persona recall" chip was there
         * during the conversation and gone after a reload.
         */
        const fileIds = ids.filter((id) => id < 0).map((id) => Math.abs(id));
        const fileTitles = await getFileSummaryTitles(fileIds, ctx.user.id);
        return rows.map((m: any) => ({
          ...m,
          recalled: parseRecalledIds(m.recalledMemoryIds).map((id: number) => ({
            id,
            title: titles.get(id) ?? fileTitles.get(Math.abs(id)) ?? "",
          })),
        }));
      }),

    /**
     * Searches across every persona the user has.
     *
     * A person looking for something they said six months ago does not
     * remember which conversation it was in.
     */
    searchAll: protectedProcedure
      .input(z.object({
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(200).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const rows = await searchAllMessages(ctx.user.id, input.query, input.limit ?? 50);
        const personas = await getPersonasByUserId(ctx.user.id);
        const names = new Map(personas.map((p) => [p.id, p.name]));
        return rows.map((row) => ({
          ...row,
          personaName: names.get(row.personaId) ?? "",
        }));
      }),

    /**
     * Rewrites a message and asks the persona again.
     *
     * The old turn and everything after it belonged to a version of the
     * conversation that is being replaced, so they go with it.
     */
    regenerate: protectedProcedure.use(rateLimit(RATE_LIMITS.llm))
      .input(z.object({
        personaId: z.number(),
        /** The assistant message to replace. */
        messageId: z.number(),
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.personaNotReadyShort") });

        /**
         * The user's own question.
         *
         * The search used to stop at the row immediately before the
         * answer — so a reply to something the user did not write (a
         * proactive message, a letter answer, a message from another
         * channel) had no question, and the regeneration said "that
         * message was not found". The search walks back to the nearest
         * *user* message now.
         */
        const previous = await getPreviousMessage(
          input.personaId,
          ctx.user.id,
          input.messageId,
          "user",
        );
        if (!previous || previous.role !== "user") {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.messageNotFound") });
        }

        /**
         * The turn that is being replaced is kept, so that it can be put
         * back.
         *
         * The old turn used to be deleted before the model was asked.
         * So a provider that was having a bad minute took the user's
         * question *and* the persona's answer away for good, and the
         * page showed an empty bubble — with no error, because the
         * failure is reported as an event and the event was not read.
         *
         * And the whole thing happens while the persona's turn is
         * held. The delete used to happen *outside* the lock — so a
         * regenerate could take away the message of a turn that was in
         * flight right now, and leave an answer with nothing above it.
         */
        return await withPersonaTurn(input.personaId, async () => {
          const replaced = await getMessagesFrom(previous.id, input.personaId, ctx.user.id);
          const removed = await deleteMessagesFrom(previous.id, input.personaId, ctx.user.id);
          if (removed === 0) throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.messageNotFound") });

          let reply = "";
          let emotionalState: string = persona.emotionalState;
          let failure: string | null = null;
          /**
           * Whether the reply is a crisis reply.
           *
           * The flag was dropped on the way out — so regenerating a
           * crisis reply gave an ordinary bubble, with no support
           * resources and no card. The one moment the app exists for,
           * and the regeneration lost it.
           */
          let crisis = false;
          for await (const event of runConversation({
            persona,
            userId: ctx.user.id,
            message: previous.content,
            providerName: (persona as any).llmProvider || undefined,
            mode: "once",
            locale: input.locale,
            signal: requestAbortSignal(ctx.req, ctx.res),
            // The turn is already held.
            turnHeld: true,
          })) {
            if (event.type === "delta") reply += event.text;
            else if (event.type === "emotion") emotionalState = event.state;
            else if (event.type === "error") failure = event.message;
            else if (event.type === "done") crisis = event.crisis === true;
          }
          if (failure || !reply) {
            // Whatever the failed turn wrote is taken away, and the turn
            // it was going to replace is put back.
            await deleteMessagesFrom(previous.id, input.personaId, ctx.user.id).catch(() => 0);
            /**
             * The turn is put back, and the failure is not hidden.
             *
             * The restore used to be swallowed — so a database that
             * refused the write left the user with neither their
             * question nor the answer, and the interface said the
             * regeneration had failed, as though nothing else had
             * happened. It is the one thing in the app that can lose
             * what the user wrote, so it says so.
             */
            try {
              await restoreMessages(replaced, input.personaId, ctx.user.id);
            } catch (restoreError) {
              console.error(
                "[Chat] The previous turn could not be put back:",
                restoreError,
              );
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: copy(ctx.locale, "errors.regenerateRestoreFailed"),
              });
            }
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: copy(ctx.locale, "errors.regenerateFailed"),
            });
          }
          return { reply, emotionalState, crisis };
        });
      }),

    /**
     * Edits a message the user sent.
     *
     * The edit is saved; the persona is not asked again. That is the
     * difference between "fix what I wrote" and "say it again".
     */
    updateMessage: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        messageId: z.number(),
        content: z.string().min(1).max(2000),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const updated = await updateUserMessage(
          input.messageId,
          ctx.user.id,
          input.content,
          input.personaId,
        );
        if (!updated) throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.messageNotEditable") });
        return { success: true };
      }),

    /** Deletes a single message. */
    deleteMessage: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        messageId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const deleted = await deleteMessage(input.messageId, ctx.user.id, input.personaId);
        if (!deleted) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),

    send: protectedProcedure.use(rateLimit(RATE_LIMITS.llm))
      .input(z.object({
        personaId: z.number(),
        message: z.string().min(1).max(2000),
        // The interface language. It decides which emotion triggers the
        // heuristic uses and which language the prompt is written in.
        locale: z.enum(["zh", "en"]).default("zh"),
        /**
         * The message being replied to.
         *
         * Without it every reply is a reply to "whatever came last",
         * and a long conversation becomes impossible to follow.
         */
        replyToId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.personaNotReady") });

        let reply = "";
        let emotionalState: string = persona.emotionalState;
        let graduationSuggested = false;
        let careNote = null;
        let crisis = false;
        let failure: string | null = null;
        /**
         * Whether the user's own message is in the transcript.
         *
         * The client takes its bubble away when a send fails — so the
         * transcript and the screen agree — and it says "the server did
         * not store the message". That is only true when the turn
         * never started.
         */
        let failureStored = false;

        /**
         * A persona that has said goodbye.
         *
         * The notice is written for the person reading it, so it is
         * carried through. It used to be replaced by "something went
         * wrong on the server" — while WeChat and Feishu said the real
         * thing. One condition, three different answers.
         */
        try {
          for await (const event of runConversation({
            persona,
            userId: ctx.user.id,
            message: input.message,
            providerName: (persona as any).llmProvider || undefined,
            mode: "once",
            locale: input.locale,
            replyToId: input.replyToId,
            // Pressing "stop" has to stop the model too, not just the
            // waiting.
            signal: requestAbortSignal(ctx.req, ctx.res),
          })) {
            if (event.type === "delta") reply += event.text;
            else if (event.type === "emotion") emotionalState = event.state;
            else if (event.type === "error") {
              failure = event.message;
              failureStored = event.storedUserMessage === true;
            }
            else if (event.type === "done") {
              graduationSuggested = event.graduationSuggested;
              careNote = event.careNote;
              crisis = event.crisis;
            }
          }
        } catch (e) {
          if (e instanceof PersonaAsleepError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
          }
          /**
           * The turn failed — and the user's message was stored.
           *
           * Everything the generator can throw happens *after* the
           * user's own message is written (the one before it — a
           * persona that has said goodbye — has its own notice). So the
           * message is in the transcript, and the client is told so
           * rather than being left to guess.
           */
          return {
            reply: "",
            emotionalState,
            graduationSuggested,
            careNote,
            crisis,
            failed: true,
          };
        }
        /**
         * A failure is a failure.
         *
         * The pipeline reports one as an event rather than as an
         * exception, so it used to arrive here as an empty reply — and
         * the mutation reported success. The user saw an empty bubble
         * with no message about it, and on WeChat and Feishu the message
         * was dropped without a word.
         */
        if (failure) {
          /**
           * The failure is reported, and the message is left where it
           * is.
           *
           * The user's own message was stored before the model was
           * called, and it stays there — the channels depend on it (a
           * person who wrote a message on WeChat cannot have it put
           * back in a composer), and the streaming path keeps it too.
           *
           * So the answer says the turn failed instead of throwing, and
           * the client leaves the bubble alone. Throwing made the
           * client take the bubble away *and* say the server had not
           * stored the message — and twenty seconds later the poll
           * brought the message back on its own.
           */
          if (failureStored) {
            return {
              reply,
              emotionalState,
              graduationSuggested,
              careNote,
              crisis,
              failed: true,
            };
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: copy(ctx.locale, "errors.replyFailed"),
          });
        }

        return { reply, emotionalState, graduationSuggested, careNote, crisis, failed: false };
      }),

    sendImage: protectedProcedure.use(rateLimit(RATE_LIMITS.upload))
      .input(z.object({
        personaId: z.number(),
        imageContent: z.string().max(MAX_BASE64_IMAGE_CHARS),
        fileName: z.string().min(1).max(255),
        mimeType: z.string().max(128),
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.personaNotReadyShort") });

        // The target model must actually understand images — otherwise the
        // picture would be dropped silently and the answer would be about
        // nothing.
        const providerName = (persona as any).llmProvider || undefined;
        const provider = await resolveProviderForUser({
          userId: ctx.user.id,
          providerName,
        });
        if (provider && !provider.capabilities.vision) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(ctx.locale, "errors.modelCannotSeeImages", { provider: provider.name }),
          });
        }

        const buffer = Buffer.from(input.imageContent, "base64");
        // The declared size is a hint; the decoded bytes are the truth.
        if (buffer.length > MAX_UPLOAD_BYTES) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.fileTooLarge") });
        }
        const safeName = sanitizeFileName(input.fileName);
        // The uploads directory is served from the app's own origin, so a
        // file the browser would run as a page is a page on that origin.
        // This route used to skip the allow-list every other upload goes
        // through, so an `.html` file could be planted and was served
        // back as one.
        const extensionProblem = checkFileExtension(safeName, "image", ctx.locale);
        if (extensionProblem) {
          throw new TRPCError({ code: "BAD_REQUEST", message: extensionProblem });
        }
        const fileKey = `chat/${ctx.user.id}/${input.personaId}/${nanoid()}-${safeName}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);

        let reply = "";
        let emotionalState: string = persona.emotionalState;
        let graduationSuggested = false;
        let careNote = null;
        let crisis = false;
        let failure: string | null = null;

        for await (const event of runConversation({
          persona,
          userId: ctx.user.id,
          message: copy(ctx.locale, "prompt.imagePlaceholder"),
          providerName,
          mode: "once",
          locale: input.locale,
          media: { url, type: "image", mimeType: input.mimeType },
          signal: requestAbortSignal(ctx.req, ctx.res),
        })) {
          if (event.type === "delta") reply += event.text;
          else if (event.type === "emotion") emotionalState = event.state;
          else if (event.type === "error") failure = event.message;
          else if (event.type === "done") {
            graduationSuggested = event.graduationSuggested;
            careNote = event.careNote;
            crisis = event.crisis;
          }
        }
        // A failure is reported, not swallowed. See the note in `send`.
        if (failure) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: copy(ctx.locale, "errors.replyFailed"),
          });
        }

        return { reply, emotionalState, imageUrl: url, graduationSuggested, careNote, crisis };
      }),

    sendVoice: protectedProcedure.use(rateLimit(RATE_LIMITS.chatMedia))
      .input(z.object({
        personaId: z.number(),
        audioContent: z.string().max(MAX_BASE64_AUDIO_CHARS),
        duration: z.number().min(0).max(600),
        fileName: z.string().min(1).max(255),
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.personaNotReadyShort") });

        const buffer = Buffer.from(input.audioContent, "base64");
        // The declared size is a hint; the decoded bytes are the truth.
        if (buffer.length > MAX_AUDIO_UPLOAD_BYTES) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.fileTooLarge") });
        }
        const safeName = sanitizeFileName(input.fileName);
        // Same allow-list as every other upload: the uploads directory is
        // served from the app's own origin, so a file the browser would
        // run as a page is a page on that origin.
        const extensionProblem = checkFileExtension(safeName, "audio", ctx.locale);
        if (extensionProblem) {
          throw new TRPCError({ code: "BAD_REQUEST", message: extensionProblem });
        }
        const fileKey = `chat/${ctx.user.id}/${input.personaId}/${nanoid()}-${safeName}`;
        const { url } = await storagePut(fileKey, buffer, "audio/webm");

        // The transcription runs on the user's own provider, like the
        // conversation does. It used to go through the server's key, so a
        // user who had configured one got a voice message transcribed by a
        // model they had not chosen — or not transcribed at all.
        const providerName = (persona as any).llmProvider || undefined;
        const voiceProvider = await resolveProviderForUser({
          userId: ctx.user.id,
          providerName,
        });
        /**
         * The transcription.
         *
         * The recording is sent to the provider's speech-to-text
         * service — the audio itself, not a description of it.
         *
         * It used to be asked for in words: the chat model was given the
         * *duration* and told to guess what the recording might have
         * said. The guess was shown to the user as their own words, it
         * was stored as their own words, and the persona answered it
         * warmly. A model told to guess does not answer "I could not
         * hear that" — so the fabrication was the normal case, not the
         * exception.
         *
         * When it fails, the persona used to be given a placeholder as
         * if the user had said it — so it answered "（语音消息）" in
         * character, warmly, as though that were what the user had
         * said. The user was never told that their voice note had not
         * been understood.
         *
         * So a failure is a failure: it is said so, and no reply is
         * composed.
         */
        const transcription = voiceProvider
          ? await llmService
              .transcribeWithProvider(voiceProvider, buffer, safeName)
              .catch((e) => {
                console.warn("[Chat] The recording could not be transcribed:", (e as Error).message);
                return "";
              })
          : "";
        if (!transcription) {
          return {
            reply: "",
            emotionalState: persona.emotionalState,
            transcription: "",
            voiceUrl: url,
            graduationSuggested: false,
            careNote: null,
            crisis: false,
            transcriptionFailed: true,
          };
        }

        let reply = "";
        let emotionalState: string = persona.emotionalState;
        let graduationSuggested = false;
        let careNote = null;
        let crisis = false;
        let failure: string | null = null;

        for await (const event of runConversation({
          persona,
          userId: ctx.user.id,
          message: transcription,
          providerName,
          mode: "once",
          locale: input.locale,
          media: { url, type: "voice" },
          signal: requestAbortSignal(ctx.req, ctx.res),
        })) {
          if (event.type === "delta") reply += event.text;
          else if (event.type === "emotion") emotionalState = event.state;
          else if (event.type === "error") failure = event.message;
          else if (event.type === "done") {
            graduationSuggested = event.graduationSuggested;
            careNote = event.careNote;
            crisis = event.crisis;
          }
        }
        // A failure is reported, not swallowed. See the note in `send`.
        if (failure) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: copy(ctx.locale, "errors.replyFailed"),
          });
        }

        return { reply, emotionalState, transcription, voiceUrl: url, graduationSuggested, careNote, crisis };
      }),

    clear: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await clearMessagesByPersonaId(input.personaId, ctx.user.id);
        return { success: true };
      }),

    search: protectedProcedure
      .input(z.object({ personaId: z.number(), query: z.string().min(1).max(200), limit: z.number().min(1).max(100).default(50) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return searchMessages(input.personaId, ctx.user.id, input.query, input.limit);
      }),

    tts: protectedProcedure.use(rateLimit(RATE_LIMITS.tts))
      .input(z.object({ text: z.string().min(1).max(500), voice: z.string().max(64).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { generateTTS } = await import("./_core/tts");
        const audioUrl = await generateTTS(input.text, input.voice, ctx.user.id);
        return { audioUrl };
      }),

    /** The voices on offer. The voice used to be hardcoded. */
    voices: publicProcedure
      .input(z.object({ locale: z.enum(["zh", "en"]).default("zh") }))
      .query(async ({ input }) => {
        const { voicesForLocale } = await import("./_core/tts");
        const { ENV } = await import("./_core/env");
        return {
          voices: voicesForLocale(input.locale),
          /**
           * Whether the read-aloud may be used.
           *
           * The voice is an online service — the text of the reply goes
           * to Microsoft. So the button is hidden when the operator has
           * switched it off, rather than offering a button that fails.
           */
          enabled: ENV.ttsEnabled,
        };
      }),

    export: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        // The export follows the language of the interface. It used to be
        // Chinese whatever the interface was, so an English-speaking user
        // downloaded a keepsake they could not read.
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        const data = await getExportData(input.personaId, ctx.user.id);
        if (!data) throw new TRPCError({ code: "NOT_FOUND" });
        const intimacyData = await getIntimacyData(input.personaId, ctx.user.id);
        const intimacy = computeIntimacy(intimacyData);
        const { generateChatExportHTML } = await import("./_core/export-html");
        /**
         * The moments the user marked.
         *
         * They were missing from this export — so the keepsake of a
         * relationship had the conversations and the memories and none
         * of the moments. The "export everything" bundle had them.
         */
        const events = await getRelationshipEvents(input.personaId, ctx.user.id, 1000);
        const html = generateChatExportHTML({
          persona: data.persona,
          messages: data.messages,
          memories: data.memories,
          emotionSnapshots: data.emotionSnapshots,
          diaryEntries: data.diaryEntries,
          letters: data.letters,
          events,
          intimacy,
        }, input.locale);
        const fileName = input.locale === "en"
          ? `${data.persona.name}-conversation.html`
          : copy(ctx.locale, "persona.exportFileName", { name: data.persona.name });
        return { html, fileName };
      }),

    /**
     * Everything the user has, in a format that does not need this app.
     *
     * The export used to be a single HTML page with the messages on it.
     * "My data" means the memories, the diaries, the snapshots, the
     * farewell letter, the relationship events and the user's own moods
     * too — and a format the user can keep.
     */
    exportAll: protectedProcedure
      .input(z.object({
        format: z.enum(["json", "markdown"]).default("json"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { buildExportBundle, exportAsJson, exportAsMarkdown } = await import(
          "./_core/export-data"
        );
        const bundle = await buildExportBundle(ctx.user.id);
        if (!bundle) throw new TRPCError({ code: "NOT_FOUND" });

        if (input.format === "markdown") {
          return {
            content: exportAsMarkdown(bundle, ctx.locale),
            fileName: `mirrai-${new Date().toISOString().slice(0, 10)}.md`,
            mimeType: "text/markdown",
          };
        }
        return {
          content: exportAsJson(bundle),
          fileName: `mirrai-${new Date().toISOString().slice(0, 10)}.json`,
          mimeType: "application/json",
        };
      }),
  }),

  wechat: router({
    getStatus: protectedProcedure.query(({ ctx }) => getBotStatus(ctx.user.id)),

    /**
     * Starts the QR-code login flow for the official WeChat ClawBot channel.
     * The user scans the returned code in WeChat to authorize the connection.
     */
    startLogin: protectedProcedure.mutation(async ({ ctx }) => {
      const status = await startLogin(ctx.user.id);
      return status;
    }),

    /** Supplies the numeric code WeChat displays when the backend asks for it. */
    submitVerifyCode: protectedProcedure
      .input(z.object({ code: z.string().min(1).max(20) }))
      .mutation(async ({ ctx, input }) => {
        const status = await submitVerifyCode(ctx.user.id, input.code);
        return status;
      }),

    cancelLogin: protectedProcedure.mutation(async ({ ctx }) => {
      const status = await cancelLogin(ctx.user.id);
      return status;
    }),

    /** Disconnects the channel. */
    stop: protectedProcedure.mutation(async ({ ctx }) => {
      await stopWeChatBot(ctx.user.id);
      /**
       * Only this user's overrides.
       *
       * The whole map was cleared — so one user disconnecting their
       * WeChat channel reset the persona that every other user had
       * chosen with "/使用", and their next WeChat message was answered
       * by the default persona.
       */
      clearAllActivePersonas(ctx.user.id);
      return { success: true };
    }),

    listBindings: protectedProcedure.query(async ({ ctx }) =>
      getWechatBindingsByUserId(ctx.user.id)
    ),

    /** Sets the default persona for a WeChat conversation. */
    setDefaultPersona: protectedProcedure
      .input(z.object({
        wechatUserId: z.string().min(1),
        personaId: z.number(),
        wechatName: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const id = await setWechatBindingPersona({
          userId: ctx.user.id,
          wechatUserId: input.wechatUserId,
          personaId: input.personaId,
          wechatName: input.wechatName ?? null,
        });
        return { id };
      }),

    unbind: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // The binding was removed, or there was nothing there to remove.
        const removed = await deleteWechatBinding(input.id, ctx.user.id);
        if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),
  }),

  /**
   * Channel-neutral management of the places a user can talk to a persona.
   *
   * The WeChat ClawBot channel keeps its own QR-login procedures in the
   * `wechat` router; everything that is common to all channels lives here.
   */
  channel: router({
    /** Lists the available channels and whether each one is connected. */
    list: protectedProcedure.query(async ({ ctx }) => {
      const channels = listChannels();
      const statuses = await Promise.all(
        channels.map(async (adapter) => {
          try {
            const status = await adapter.status(ctx.user.id);
            return {
              id: adapter.id,
              label: channelLabel(adapter, ctx.locale),
              requiresCredentials: adapter.requiresCredentials,
              connected: status.connected,
              status: status.status,
            };
          } catch {
            return {
              id: adapter.id,
              label: channelLabel(adapter, ctx.locale),
              requiresCredentials: adapter.requiresCredentials,
              connected: false,
              status: "error",
            };
          }
        }),
      );
      return statuses;
    }),

    getStatus: protectedProcedure
      .input(z.object({ channel: z.enum(["wechat", "feishu"]) }))
      .query(async ({ ctx, input }) => {
        const adapter = getChannelAdapter(input.channel);
        if (!adapter) throw new TRPCError({ code: "NOT_FOUND" });
        return adapter.status(ctx.user.id);
      }),

    start: protectedProcedure
      .input(z.object({ channel: z.enum(["wechat", "feishu"]) }))
      .mutation(async ({ ctx, input }) => {
        const adapter = getChannelAdapter(input.channel);
        if (!adapter) throw new TRPCError({ code: "NOT_FOUND" });
        await adapter.start(ctx.user.id, ctx.locale);
        return { success: true };
      }),

    stop: protectedProcedure
      .input(z.object({ channel: z.enum(["wechat", "feishu"]) }))
      .mutation(async ({ ctx, input }) => {
        const adapter = getChannelAdapter(input.channel);
        if (!adapter) throw new TRPCError({ code: "NOT_FOUND" });
        await adapter.stop(ctx.user.id);
        return { success: true };
      }),

    /** Stores the credentials a channel needs, encrypted at rest. */
    setCredentials: protectedProcedure
      .input(z.object({
        channel: z.enum(["wechat", "feishu"]),
        /**
         * Either half may be left out.
         *
         * The one that was left out keeps the value it had — so a user
         * rotating the secret does not have to retype the app id,
         * which they cannot see, because it is never shown to them
         * again.
         */
        appId: z.string().min(1).max(128).optional(),
        appSecret: z.string().min(1).max(256).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.channel !== "feishu") {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.channelNeedsNoCredentials") });
        }
        await feishuAdapter.setCredentials(ctx.user.id, {
          appId: input.appId,
          appSecret: input.appSecret,
        });
        return { success: true };
      }),

    listBindings: protectedProcedure
      .input(z.object({ channel: z.enum(["wechat", "feishu"]).optional() }))
      .query(async ({ ctx, input }) =>
        getChannelBindingsByUserId(ctx.user.id, input.channel)
      ),

    setDefaultPersona: protectedProcedure
      .input(z.object({
        channel: z.enum(["wechat", "feishu"]),
        targetId: z.string().min(1).max(255),
        personaId: z.number(),
        targetName: z.string().max(255).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        if (input.channel === "wechat") {
          await setWechatBindingPersona({
            userId: ctx.user.id,
            wechatUserId: input.targetId,
            personaId: input.personaId,
            wechatName: input.targetName ?? null,
          });
          return { success: true };
        }

        const id = await setChannelBindingPersona({
          userId: ctx.user.id,
          channel: input.channel,
          targetId: input.targetId,
          personaId: input.personaId,
          targetName: input.targetName ?? null,
        });
        return { id };
      }),

    /**
     * The persona a channel talks to.
     *
     * A conversation on Feishu only learns its id when the first
     * message arrives — so the choice cannot be made per conversation
     * from the interface. And the interface had no choice to make at
     * all: the bot said "choose a persona under Settings → Feishu",
     * and there was nothing there to choose with.
     *
     * This is the channel-level answer: the persona the channel talks
     * to, until the conversation says otherwise.
     */
    setChannelDefault: protectedProcedure
      .input(z.object({
        channel: z.enum(["wechat", "feishu"]),
        personaId: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        await setChannelDefaultPersona({
          userId: ctx.user.id,
          channel: input.channel,
          personaId: input.personaId,
        });
        return { success: true };
      }),

    /** The persona a channel talks to, if one has been chosen. */
    getChannelDefault: protectedProcedure
      .input(z.object({ channel: z.enum(["wechat", "feishu"]) }))
      .query(async ({ ctx, input }) => {
        const row = await getChannelDefaultPersona(ctx.user.id, input.channel);
        return { personaId: row?.personaId ?? null };
      }),

    unbind: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // The binding was removed, or there was nothing there to remove.
        const removed = await deleteChannelBinding(input.id, ctx.user.id);
        if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),
  }),

  /**
   * The persona template library.
   *
   * Templates are local: the built-in ones ship with the app and the user's
   * own live in the database. There is deliberately no remote marketplace —
   * the product's rule is that user data never leaves the machine.
   */
  template: router({
    /** Lists the built-in templates together with the user's own. */
    list: protectedProcedure.query(async ({ ctx }) => {
      const builtins: PersonaTemplate[] = getBuiltinTemplates();
      const own = await getUserTemplates(ctx.user.id);
      return [
        ...builtins.map((t) => ({ ...t, builtin: true, id: t.id, rowId: null })),
        ...own.map((t) => ({
          schemaVersion: t.schemaVersion,
          // `id` identifies the template for instantiate/export; `rowId` is
          // the database row, which update/delete need.
          id: t.templateId,
          rowId: t.id,
          name: t.name,
          family: t.family as PersonaTemplate["family"],
          description: t.description ?? "",
          tags: (t.tags as string[]) ?? [],
          personaData: t.personaData as any,
          scenePack: (t.scenePack as any) ?? undefined,
          author: t.author ?? undefined,
          license: t.license ?? undefined,
          builtin: false,
        })),
      ];
    }),

    /** Saves a persona as a reusable template. */
    createFromPersona: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        tags: z.array(z.string().max(50)).max(20).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (!persona.personaData) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.personaNotAnalyzed") });
        }

        // The id has to be unique.
        //
        // It used to end with the clock, so two templates of the same
        // name created in the same millisecond shared an id — and the
        // export and the instantiate both take the *first* match, so one
        // shadowed the other.
        const templateId = `${input.name.trim().replace(/\s+/g, "-").toLowerCase()}-${nanoid()}`;
        const id = await createUserTemplate({
          userId: ctx.user.id,
          templateId,
          name: input.name.trim(),
          family: "relationship",
          description: input.description ?? "",
          tags: input.tags ?? [],
          personaData: persona.personaData as any,
        });
        return { id, templateId };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        tags: z.array(z.string().max(50)).max(20).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const data: Record<string, unknown> = {};
        if (input.name !== undefined) data.name = input.name;
        if (input.description !== undefined) data.description = input.description;
        if (input.tags !== undefined) data.tags = input.tags;
        const changed = await updateUserTemplate(input.id, ctx.user.id, data as any);
        if (!changed) {
          // The row does not exist, or it belongs to somebody else. The
          // update is scoped to the owner, so it was silently not
          // done — and the caller used to report that as a success.
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const removed = await deleteUserTemplate(input.id, ctx.user.id);
        if (!removed) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { success: true };
      }),

    /** Imports a template from a JSON file the user picked. */
    import: protectedProcedure
      .input(z.object({ fileContent: z.string().min(1).max(500_000) }))
      .mutation(async ({ ctx, input }) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(input.fileContent);
        } catch {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.invalidJson") });
        }

        const validation = validateTemplate(parsed, ctx.locale);
        if (!validation.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: validation.error });
        }

        const template = normalizeTemplate(parsed);
        const templateId = `${template.id}-${nanoid()}`;
        const id = await createUserTemplate({
          userId: ctx.user.id,
          templateId,
          name: template.name,
          family: template.family,
          description: template.description,
          tags: template.tags,
          personaData: template.personaData as any,
          scenePack: template.scenePack as any,
          author: template.author,
          license: template.license,
          schemaVersion: template.schemaVersion,
        });
        return { id, templateId };
      }),

    /** Exports a template as a JSON file. */
    export: protectedProcedure
      .input(z.object({ templateId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const builtin = getBuiltinTemplates().find((t) => t.id === input.templateId);
        if (builtin) {
          return {
            fileName: `${builtin.id}.json`,
            content: JSON.stringify(builtin, null, 2),
          };
        }

        const own = await getUserTemplates(ctx.user.id);
        const row = own.find((t) => t.templateId === input.templateId);
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });

        const template = normalizeTemplate({
          schemaVersion: row.schemaVersion,
          id: row.templateId,
          name: row.name,
          family: row.family,
          description: row.description,
          tags: row.tags,
          personaData: row.personaData,
          scenePack: row.scenePack,
          author: row.author,
          license: row.license,
        });
        return {
          fileName: `${template.id}.json`,
          content: JSON.stringify(template, null, 2),
        };
      }),

    /** Creates a persona from a template. */
    instantiate: protectedProcedure
      .input(z.object({ templateId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const builtin = getBuiltinTemplates().find((t) => t.id === input.templateId);
        let personaData: unknown;
        let name: string;
        let family: "colleague" | "relationship" | "celebrity";

        if (builtin) {
          personaData = builtin.personaData;
          name = builtin.name;
          family = builtin.family;
        } else {
          const own = await getUserTemplates(ctx.user.id);
          const row = own.find((t) => t.templateId === input.templateId);
          if (!row) throw new TRPCError({ code: "NOT_FOUND" });
          personaData = row.personaData;
          name = row.name;
          family = row.family as typeof family;
        }

        const personaId = await createPersona({
          userId: ctx.user.id,
          name,
          relationshipDesc: null,
          togetherFrom: null,
          togetherTo: null,
          personaData: personaData as any,
          analysisStatus: "ready",
          analysisProgress: 100,
          analysisMessage: copy(ctx.locale, "persona.fromTemplate"),
        });

        return { personaId, family };
      }),
  }),

  /**
   * SillyTavern character cards.
   *
   * A persona can be exported as a PNG card that other tools understand, and
   * such a card can be imported back.
   */
  personaCard: router({
    /** Exports a persona as a PNG character card. */
    export: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (!persona.personaData) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.personaNotAnalyzed") });
        }

        const memories = await getMemoriesByPersonaId(input.personaId, ctx.user.id);
        // The card is localised with the reader's language everywhere
        // except the system prompt — which stayed Chinese, so an English
        // card carried a Chinese prompt.
        const systemPrompt = buildSystemPrompt(persona, { locale: ctx.locale });

        /**
         * The opening lines come from the persona's own scene, so the
         * card starts the conversation the way the app does.
         *
         * It took the first scene that had any opening lines — and the
         * built-in scenes are listed first, so every card opened with a
         * generic built-in scene's lines and never with the persona's.
         */
        const scenes = await getScenes(ctx.user.id);
        const activeSceneId = (persona as any).activeSceneId ?? null;
        const scene = activeSceneId
          ? scenes.find((s) => s.id === activeSceneId)
          : undefined;

        const card = personaDataToCard({
          name: persona.name,
          relationshipDesc: persona.relationshipDesc ?? undefined,
          togetherFrom: persona.togetherFrom ?? undefined,
          togetherTo: persona.togetherTo ?? undefined,
          personaData: persona.personaData as any,
          systemPrompt,
          sceneStarters: (scene?.starters as string[] | undefined) ?? [],
          intimacyLevel: persona.intimacyLevel,
          memories: memories.map((m) => ({
            content: m.description || m.title,
            name: m.title,
            anchor: m.category === "anchor",
            keys: m.title ? [m.title] : undefined,
          })),
          creator: "Mirrai",
        }, ctx.locale);

        // The card keeps the persona's picture when it has one; otherwise the
        // application's own icon is used.
        const image = await resolveAvatarImage(persona.avatarUrl);
        const png = writeCardToPng(image, card);

        return {
          fileName: `${persona.name}.png`,
          fileContent: png.toString("base64"),
        };
      }),

    /** Imports a PNG character card, creating or updating a persona. */
    import: protectedProcedure
      .input(z.object({
        fileContent: z.string().min(1).max(20_000_000),
        personaId: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        let card;
        try {
          card = readCardFromPng(Buffer.from(input.fileContent, "base64"));
        } catch (e) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(ctx.locale, "errors.cardUnreadable", { reason: (e as Error).message }),
          });
        }

        const imported = cardToPersonaImport(card, ctx.locale);
        const personaData = cardToNormalizedPersona(card, ctx.locale);

        if (input.personaId) {
          const persona = await getPersonaById(input.personaId, ctx.user.id);
          if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
          await updatePersona(input.personaId, ctx.user.id, {
            name: imported.name,
            relationshipDesc: imported.relationshipDesc || null,
            togetherFrom: imported.togetherFrom || null,
            togetherTo: imported.togetherTo || null,
            personaData: personaData as any,
            analysisStatus: "ready",
            analysisProgress: 100,
          });
          return { personaId: input.personaId, created: false };
        }

        const personaId = await createPersona({
          userId: ctx.user.id,
          name: imported.name,
          relationshipDesc: imported.relationshipDesc || null,
          togetherFrom: imported.togetherFrom || null,
          togetherTo: imported.togetherTo || null,
          personaData: personaData as any,
          source: "card",
          analysisStatus: "ready",
          analysisProgress: 100,
          analysisMessage: copy(ctx.locale, "persona.fromCard"),
        });

        return { personaId, created: true };
      }),
  }),

  /**
   * Proactive reminders — anniversaries and the like.
   *
   * The scheduler delivers them; the client lists them and lets the user
   * dismiss one.
   */
  reminder: router({
    list: protectedProcedure.query(async ({ ctx }) =>
      getActiveReminders(ctx.user.id)
    ),

    dismiss: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // The reminder was dismissed, or there was nothing there.
        const dismissed = await dismissReminder(input.id, ctx.user.id);
        if (!dismissed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),
  }),

  /**
   * Multi-source collection.
   *
   * The Python collectors were on disk but unreferenced; they are now driven
   * from here and their output is normalised into one format.
   */
  collector: router({
    /** Lists the platforms a chat history can be collected from. */
    listSources: protectedProcedure.query(({ ctx }) =>
      COLLECTOR_SOURCES.map((source) => ({
        id: source.id,
        label: sourceLabel(source, ctx.locale),
        requiresBrowser: source.requiresBrowser ?? false,
        // The credential fields the authorisation form has to render.
        credentialKeys: source.credentialKeys ?? [],
        /**
         * Whether the source reads a file the user has to supply.
         *
         * The e-mail and the WeChat export sources do: an export of
         * their own mail, or of their own chat history. There was
         * nowhere to give it, so both sources failed the moment they
         * were chosen.
         */
        needsFile: source.id === "email" || source.id === "wechat_export",
        /**
         * Whether the source needs the user's own browser profile.
         *
         * The DingTalk source reads the message history by driving a
         * browser, and the browser's login *is* the credential — so
         * the profile has to be named, and there was nowhere to name
         * it.
         */
        needsChromeProfile: source.needsChromeProfile === true,
      }))
    ),

    /**
     * A preview of what a collection brought in.
     *
     * The user is about to hand this material to a model, so it has to be
     * visible first.
     */
    preview: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        source: z.enum(["feishu", "dingtalk", "slack", "email", "wechat_export"]).optional(),
        limit: z.number().min(1).max(500).default(50),
      }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        /**
         * The sources, counted on their own.
         *
         * The preview asks for the sources *and* the messages, and the
         * messages are the last few — so the whole history used to be
         * read to answer a question about fifty lines of it.
         */
        const sources = await getCollectedMessageSources(input.personaId, ctx.user.id);
        const messages = await getCollectedMessagesForPersona(input.personaId, ctx.user.id, {
          source: input.source ?? null,
          limit: input.limit,
          // The last few, not the first few ever collected.
          newest: true,
        });
        // How many there are, not how many are shown.
        const total = await countCollectedMessagesForPersona(
          input.personaId,
          ctx.user.id,
          input.source ?? null,
        );

        return {
          total,
          sources,
          messages: messages
            .map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
              source: m.source,
            })),
        };
      }),

    /**
     * Lists the collection jobs of the current user.
     *
     * The live jobs come from the in-memory runner; the persisted ones are
     * what is left after a restart.
     */
    listJobs: protectedProcedure.query(async ({ ctx }) => {
      const live = listCollectorJobs(String(ctx.user.id)).map((job) => ({
        id: job.id,
        source: job.source,
        status: job.status,
        progress: job.progress,
        messageCount: job.messageCount,
        foundCount: job.foundCount ?? job.messageCount,
        truncated: job.truncated === true,
        error: job.error,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      }));

      const persisted = await listPersistedCollectorJobs(ctx.user.id);
      const merged = new Map<string, (typeof live)[number]>();
      for (const job of persisted) merged.set(job.id, job as (typeof live)[number]);
      for (const job of live) merged.set(job.id, job);
      return Array.from(merged.values());
    }),

    /** Starts a collection run. */
    start: protectedProcedure
      .input(z.object({
        source: z.enum(["feishu", "dingtalk", "slack", "email", "wechat_export"]),
        personaId: z.number(),
        target: z.string().max(200).optional(),
        limit: z.number().min(1).max(5000).optional(),
        /**
         * The file the source reads, when it reads one.
         *
         * The e-mail and the WeChat export sources read a file the user
         * has: an export of their own mail, or of their own chat
         * history. There was nowhere to give it — the procedure did not
         * accept one — so both sources failed the moment they were
         * chosen, with an error about a missing option.
         */
        fileId: z.number().optional(),
        /**
         * The browser profile the source reads.
         *
         * The DingTalk source reads the message history by driving a
         * browser, and the browser's login *is* the credential — so the
         * profile has to be the user's own and it has to be named.
         * There was nowhere to name it: the procedure did not accept
         * one, so the source could be authorised and could never
         * collect.
         */
        chromeProfile: z.string().min(1).max(500).optional(),
      }))
      .use(rateLimit(RATE_LIMITS.collector))
      .mutation(async ({ ctx, input }) => {
        // The persona has to be the caller's own.
        //
        // Every other procedure that takes a `personaId` checks this
        // first. This one did not, so a collection run could be pointed
        // at somebody else's persona: the job wrote the material it
        // gathered into that persona's namespace, and the rows outlived
        // the persona because they are not the caller's to delete.
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        /**
         * The file the source reads.
         *
         * It is an uploaded file of the caller's own, and the path is
         * resolved inside the uploads directory — so the collector is
         * pointed at a file the user uploaded and at nothing else.
         */
        let options: Record<string, string> | undefined;
        if (input.fileId !== undefined) {
          const file = await getPersonaFileById(input.fileId, ctx.user.id);
          if (!file) throw new TRPCError({ code: "NOT_FOUND" });
          if (file.personaId !== input.personaId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.collectorFileMismatch") });
          }
          const path = resolveStoredPath(file.fileKey);
          if (!path) throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.collectorFileMissing") });
          options = { file: path };
        }

        /**
         * The browser profile, when the source reads one.
         *
         * It is the user's own path on the machine the app runs on —
         * so it is passed on as it is, and the collector is pointed at
         * a folder the user named.
         */
        if (input.chromeProfile !== undefined) {
          const profile = input.chromeProfile.trim();
          if (!profile || profile.includes("\0")) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: copy(ctx.locale, "errors.collectorChromeProfileInvalid"),
            });
          }
          options = { ...(options ?? {}), chrome_profile: profile };
        }

        let handle;
        try {
          handle = await enqueueCollectorJob({
            userId: String(ctx.user.id),
            personaId: String(input.personaId),
            source: input.source,
            input: {
              target: input.target,
              limit: input.limit,
              ...(options ? { options } : {}),
            },
          });
        } catch (error) {
          /**
           * The queue was full.
           *
           * The error used to reach the browser as the generic
           * "something went wrong on the server", so the user had no
           * idea that the queue was the problem.
           */
          if (error instanceof CollectorQueueFullError) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: copy(
                ctx.locale,
                error.perUser ? "collectors.queueFullForYou" : "collectors.queueFull",
                { count: error.waiting },
              ),
            });
          }
          throw error;
        }
        return { jobId: handle.id };
      }),

    /**
     * Authorises a source and stores its credentials.
     *
     * The credentials are encrypted before they are written, so the row in
     * `collection_sources` never holds a readable secret.
     */
    authorizeSource: protectedProcedure
      .input(z.object({
        source: z.enum(["feishu", "dingtalk", "slack", "email", "wechat_export"]),
        target: z.string().max(200).optional(),
        /** The credential values, keyed by the source's credential keys. */
        credentials: z.record(z.string(), z.string().max(4000)).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const connector = getCollector(input.source);
        if (!connector) {
          throw new TRPCError({ code: "NOT_FOUND", message: copy(ctx.locale, "errors.unknownCollector") });
        }

        /**
         * Whose collection this is.
         *
         * The user id was missing — and it is what the credentials are
         * held under. So the check that follows looked in a slot with
         * no owner, found nothing, and reported "not authorised"
         * straight after the user had authorised it. And the
         * credentials that were saved were the empty ones.
         */
        const collectInput = { target: input.target, userId: ctx.user.id } as any;

        if (input.credentials && connector.importCredentials) {
          // The user id matters: the credentials are held against the
          // user who supplied them, and without it they went into a
          // shared slot that every user could reach.
          connector.importCredentials(input.credentials as any, ctx.user.id);
        }

        let authState: any = null;
        try {
          authState = await connector.checkAuth(collectInput);
        } catch (e) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(ctx.locale, "errors.authorisationFailed", { reason: (e as Error).message }),
          });
        }

        // The credentials are stored encrypted; the auth state is a plain
        // summary of what the check found.
        const { saveConnectorSource } = await import("./collectors/db-store");
        try {
          await saveConnectorSource({
            userId: ctx.user.id,
            connector,
            input: collectInput,
            authState,
          });
        } catch (e) {
          /**
           * The storage failed, so the authorisation did not happen.
           *
           * The failure was swallowed and the procedure reported
           * success. So the user saw "authorised" — and the
           * credentials lived only in the process's memory, where they
           * were cleared when the next job finished. The next
           * collection then had no credentials at all, and the user had
           * no idea why.
           */
          console.warn("[Collectors] Could not store the source:", e);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: copy(ctx.locale, "errors.collectorCredentialsNotSaved"),
          });
        }

        /**
         * The plaintext is not kept.
         *
         * The credentials are in the database, encrypted, and the job
         * restores them from there before it runs. So the plaintext
         * copy in the process's memory is of no use to anybody — and it
         * sat there for the server's whole life.
         */
        try {
          const { clearRestoredCredentials } = await import("./collectors/types");
          clearRestoredCredentials(input.source, ctx.user.id);
        } catch (e) {
          console.warn("[Collectors] Could not clear the credentials:", e);
        }

        return { authState };
      }),

    /** The sources the user has already authorised. */
    listAuthorizedSources: protectedProcedure.query(async ({ ctx }) => {
      const { listCollectionSources } = await import("./collectors/db-store");
      /**
       * The sources, or an error.
       *
       * The error used to be swallowed, so a transient database failure
       * was rendered as "you have not authorised any source" — and the
       * user was sent off to re-authorise credentials that were already
       * stored.
       */
      const sources = await listCollectionSources(ctx.user.id);
      return sources.map((s: any) => ({
        source: s.source,
        label: s.label,
        status: s.status,
        authState: s.authState,
        lastSyncedAt: s.lastSyncedAt,
        // The secret itself is never returned.
        hasCredentials: !!s.config?.encrypted,
      }));
    }),

    /**
     * Stops a collection run.
     *
     * A collection can run for half an hour — the DingTalk one drives a
     * browser — and there was no way to stop it. The function that
     * stops it was written and exported; nothing called it.
     */
    cancel: protectedProcedure
      .input(z.object({ jobId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        /**
         * The job has to be the caller's own.
         *
         * The job id is the only thing the caller sends, and it is
         * enough to stop somebody else's collection — so it is checked
         * against the owner first, the way every other procedure that
         * takes an id is.
         */
        const job = getCollectorJob(input.jobId);
        if (!job || job.userId !== String(ctx.user.id)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        const cancelled = cancelCollectorJob(input.jobId);
        if (!cancelled) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(ctx.locale, "errors.collectorNotRunning"),
          });
        }
        return { success: true };
      }),

    /** Reports the progress of one job. */
    getJob: protectedProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ ctx, input }) => {
        /**
         * The live job, or the persisted one.
         *
         * The job list is read from the database — so a job that
         * survived a restart is in the list, and clicking it returned
         * "not found" because the detail came from the process's
         * memory. The panel then spun on "loading" for ever.
         */
        const live = getCollectorJob(input.jobId);
        if (live && live.userId === String(ctx.user.id)) {
          return {
            id: live.id,
            source: live.source,
            status: live.status,
            progress: live.progress,
            messageCount: live.messageCount,
            foundCount: live.foundCount ?? live.messageCount,
            truncated: live.truncated === true,
            error: live.error,
            startedAt: live.startedAt,
            finishedAt: live.finishedAt,
          };
        }
        const persisted = await getPersistedCollectorJob(input.jobId, ctx.user.id);
        if (!persisted) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return persisted;
      }),
  }),

  skillEngine: router({
    startPipeline: protectedProcedure
      /**
       * The same limit as the other entry point.
       *
       * A distillation is a multi-stage run of model calls, and this
       * procedure had no limit at all — so it was the cheapest way to
       * start as many of them as you liked.
       */
      .use(rateLimit(RATE_LIMITS.llmHeavy))
      .input(z.object({
        personaId: z.number(),
        characterFamily: z.enum(["colleague", "relationship", "celebrity"]).default("relationship"),
        // The celebrity research profile. Without it the celebrity family
        // runs the ordinary three-stage build.
        researchProfile: z.enum(["budget-friendly", "budget-unfriendly"]).optional(),
        // The named preset. When it is given it decides the family, the
        // research profile and the depth of the run.
        mode: z.enum(["fast", "standard", "deep", "colleague", "celebrity"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        /**
         * There has to be something to read.
         *
         * The other entry point checks this; this one did not — and the
         * pipeline is happy to run on nothing, in which case it writes a
         * person the model invented over the one the user built by
         * hand. The name survives, so nothing looks wrong.
         */
        const material = await readDistillationMaterial(input.personaId, ctx.user.id);
        if (!hasDistillationMaterial(material)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(ctx.locale, "errors.nothingToDistil"),
          });
        }

        startPersonaDistillation({
          locale: ctx.locale,
          personaId: input.personaId,
          // The provider the persona is pinned to.
          //
          // The other entry point passes it and this one did not — so a
          // persona set to a local model was distilled with the user's
          // default provider instead, and the material went there.
          provider: (persona as any).llmProvider ?? undefined,
          userId: ctx.user.id,
          name: persona.name,
          characterFamily: input.characterFamily,
          researchProfile: input.researchProfile ?? null,
          mode: input.mode ?? null,
          material,
        }).catch((e) => console.error("[SkillEngine] Pipeline error:", e));

        return { success: true };
      }),

    getJobStatus: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ ctx, input }) => {
        const job = await getSkillJobById(input.jobId, ctx.user.id);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        return job;
      }),

    /**
     * The artefacts of the celebrity research flow.
     *
     * The audit stage records what it could not find — how many sources are
     * missing, how many contradictions are unresolved — so the UI can say
     * what is wrong instead of showing a generic failure.
     */
    getResearchProfile: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const profiles = await getResearchProfilesByPersonaId(
          input.personaId,
          ctx.user.id,
        );
        return profiles[0] ?? null;
      }),

    /**
     * Installs a generated skill package into one of the supported hosts.
     *
     * The job is looked up by id *and* owner, so a job id from another
     * account cannot be used to install a skill.
     */
    exportSkill: protectedProcedure
      .input(z.object({
        jobId: z.number(),
        host: z.enum(["claude-code", "openclaw", "codex", "hermes"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const job = await getSkillJobById(input.jobId, ctx.user.id);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        if (!job.generatedSkillPath) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: copy(ctx.locale, "errors.skillNotGenerated"),
          });
        }

        try {
          return await exportSkillToHost({
            skillPath: job.generatedSkillPath,
            host: input.host,
          }, ctx.locale);
        } catch (e) {
          console.error("[SkillEngine] Skill export failed:", e);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            /**
             * The message the user gets is not the message the error
             * had.
             *
             * The raw one carries the server's absolute paths, the path
             * of the Python interpreter and the Python traceback — none
             * of which belong in a browser, and all of which say where
             * the server's files are. The log has them.
             */
            message: copy(ctx.locale, "errors.skillExportFailed"),
          });
        }
      }),
  }),

  llmConfig: router({
    /**
     * Lists the user's provider configurations.
     *
     * API keys are never returned in full — only whether one is set and its
     * last four characters.
     */
    list: protectedProcedure.query(async ({ ctx }) => {
      const configs = await getLlmConfigsByUserId(ctx.user.id);
      return configs.map((config) => ({
        id: config.id,
        providerName: config.providerName,
        isDefault: config.isDefault,
        baseUrl: config.baseUrl,
        model: config.model,
        systemMessage: config.systemMessage,
        // The settings that are read as numbers are checked on the way
        // out as well: a row written before the check existed would
        // otherwise put a word into a number field in the interface.
        extraConfig: sanitizeExtraConfig(config.extraConfig),
        hasKey: !!config.apiKey,
        apiKeyHint: config.apiKeyHint ?? null,
        createdAt: config.createdAt,
      }));
    }),

    getDefault: protectedProcedure.query(async ({ ctx }) => {
      const config = await getDefaultLlmConfig(ctx.user.id);
      if (!config) return null;
      return {
        id: config.id,
        providerName: config.providerName,
        isDefault: config.isDefault,
        baseUrl: config.baseUrl,
        model: config.model,
        // Checked on the way out — see `llmConfig.list`.
        extraConfig: sanitizeExtraConfig(config.extraConfig),
        hasKey: !!config.apiKey,
        apiKeyHint: config.apiKeyHint ?? null,
      };
    }),

    listProviders: protectedProcedure.query(() => registry.list()),

    upsert: protectedProcedure
      .input(z.object({
        providerName: z.string().min(1),
        apiKey: z.string().max(512).optional(),
        /**
         * The endpoint and the model.
         *
         * They accept `null` — an empty field means "leave it alone",
         * so a user could never *remove* a base URL they had set. A
         * cleared field is now a removal.
         */
        baseUrl: z.string().max(512).nullable().optional(),
        model: z.string().max(128).nullable().optional(),
        /**
         * The provider's own settings.
         *
         * Bounded: the record was accepted in any shape and any size,
         * and it is stored in a JSON column that every read of the
         * configuration brings back.
         */
        extraConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).refine(
          (value) => Object.keys(value).length <= 50 &&
            JSON.stringify(value).length <= 16_000,
          "The extra configuration is too large",
        ).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        assertKnownProvider(input.providerName, ctx.locale);
        const { apiKey, ...rest } = input;
        const payload: Parameters<typeof upsertLlmConfig>[1] = {
          ...rest,
          // A cleared field is a removal, not "leave it alone".
          ...(rest.baseUrl === null ? { baseUrl: null } : {}),
          ...(rest.model === null ? { model: null } : {}),
          /**
           * The settings that are read as numbers are checked here too.
           *
           * This was the second write path, and it did not check them —
           * so a temperature of "hot" was stored and went straight to the
           * provider, which answered with a 400 and the interface said
           * "the reply failed".
           */
          ...(rest.extraConfig !== undefined
            ? { extraConfig: sanitizeExtraConfig(rest.extraConfig) }
            : {}),
        };

        if (apiKey) {
          // The key is stored encrypted; only a hint is kept in the clear.
          payload.apiKey = await encryptSecret(apiKey);
          payload.apiKeyHint = apiKey.slice(-4);
        }

        const id = await upsertLlmConfig(ctx.user.id, payload);
        invalidateUserProviderCache(ctx.user.id);
        return { id };
      }),

    /**
     * Replaces only the API key, leaving the rest of the configuration alone.
     *
     * The key is stored encrypted; the response never contains it.
     */
    updateApiKey: protectedProcedure
      .input(z.object({
        providerName: z.string().min(1),
        apiKey: z.string().min(1).max(512),
      }))
      .mutation(async ({ ctx, input }) => {
        assertKnownProvider(input.providerName, ctx.locale);
        const encrypted = await encryptSecret(input.apiKey);
        const id = await upsertLlmConfig(ctx.user.id, {
          providerName: input.providerName,
          apiKey: encrypted,
          apiKeyHint: input.apiKey.slice(-4),
        });
        invalidateUserProviderCache(ctx.user.id);
        return { id };
      }),

    updateExtraConfig: protectedProcedure
      .input(z.object({
        /**
         * Bounded, like the other write path.
         *
         * This one accepted any record of any size — so the fifty
         * megabyte body limit became a fifty megabyte blob in the
         * user's own configuration, which every read of the settings
         * brought back and every chat turn read again.
         */
        extraConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).refine(
          (value) => Object.keys(value).length <= 50 &&
            JSON.stringify(value).length <= 16_000,
          "The extra configuration is too large",
        ),
      }))
      .mutation(async ({ ctx, input }) => {
        const config = await getDefaultLlmConfig(ctx.user.id);
        if (!config) throw new TRPCError({ code: "NOT_FOUND", message: copy(ctx.locale, "errors.noDefaultProvider") });
        /**
         * The settings that are read as numbers are checked here.
         *
         * They were stored as they arrived, so a value that was not a
         * number made the context limit NaN — and `slice(NaN)` is the
         * whole history. Every turn then sent two hundred messages to
         * the provider, the provider answered "context length
         * exceeded", and the bill went up on every turn.
         */
        const incoming = { ...input.extraConfig } as Record<string, unknown>;
        const mergedExtra: Record<string, unknown> = {};
        const bounded = {
          contextLimit: clampContextLimit(incoming.contextLimit ?? (config.extraConfig as any)?.contextLimit),
          temperature: clampTemperature(incoming.temperature ?? (config.extraConfig as any)?.temperature),
          maxTokens: clampMaxTokens(incoming.maxTokens ?? (config.extraConfig as any)?.maxTokens),
        };
        for (const key of Object.keys(incoming)) {
          if (key in bounded) continue;
          mergedExtra[key] = incoming[key];
        }
        const merged = { ...((config.extraConfig as any) || {}), ...mergedExtra, ...bounded };
        await upsertLlmConfig(ctx.user.id, { providerName: config.providerName, extraConfig: merged });
        invalidateUserProviderCache(ctx.user.id);
        return { success: true };
      }),

    setDefault: protectedProcedure
      .input(z.object({ providerName: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        assertKnownProvider(input.providerName, ctx.locale);
        /**
         * The default is set, or it is not.
         *
         * The provider name is checked against the *registry*, not
         * against the rows this user has — so naming a provider they
         * never saved changed nothing, and the user was told it had.
         * The next conversation then failed with "no default
         * provider".
         */
        const changed = await setDefaultLlmConfig(ctx.user.id, input.providerName);
        if (!changed) {
          throw new TRPCError({ code: "NOT_FOUND", message: copy(ctx.locale, "errors.providerNotConfigured") });
        }
        invalidateUserProviderCache(ctx.user.id);
        return { success: true };
      }),
  }),


  memory: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const [items, total] = await Promise.all([
          getMemoriesByPersonaId(input.personaId, ctx.user.id),
          countMemories(input.personaId, ctx.user.id),
        ]);
        // The total is returned so the interface can say when the list
        // has been cut short. It used to be cut short silently.
        return { items, total };
      }),

    create: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        category: z.enum(["milestone", "memory", "anniversary", "anchor"]).default("memory"),
        /**
         * The day, or the month and the day.
         *
         * It was any string at all, so "sometime last summer" was
         * stored as a date — and the anniversary sweep compares the
         * month and the day, so that anniversary was never announced
         * and nothing ever said the date could not be read.
         */
        date: z.string().max(50).refine(isMemoryDate, { message: "Not a day." }).optional(),
        /** A structured fact key for anchor memories, e.g. "birthday". */
        factKey: z.string().max(120).optional(),
        /**
         * Whose memory this is: "them" or "me".
         *
         * A memory about the user's own life is the user's, and the
         * persona has to be able to tell the two apart.
         */
        subject: z.enum(["them", "me"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const id = await createMemory({ ...input, userId: ctx.user.id });
        return { id };
      }),

    /**
     * Edits a memory, or pins it.
     *
     * A pinned memory is injected into every single prompt — it is the
     * one the user wants the persona never to forget. The field existed
     * and the retrieval read it, but nothing ever wrote it, so there was
     * no way to pin anything.
     */
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        category: z.enum(["milestone", "memory", "anniversary", "anchor"]).optional(),
        date: z.string().max(50).refine(isMemoryDate, { message: "Not a day." }).nullable().optional(),
        isPinned: z.boolean().optional(),
        importance: z.number().int().min(1).max(10).optional(),
        /** Whose memory this is: "them" or "me". */
        subject: z.enum(["them", "me"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const row = await updateMemory(id, ctx.user.id, data);
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true, memory: row };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // The memory was removed, or there was nothing there to remove.
        const removed = await deleteMemory(input.id, ctx.user.id);
        if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),

    autoExtract: protectedProcedure.use(rateLimit(RATE_LIMITS.llmHeavy))
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const history = await getMessagesByPersonaId(input.personaId, ctx.user.id, 50);
        if (history.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.noMessagesToExtract") });

        // The extraction is the same one that runs on its own, so the
        // button cannot store what is already held.
        const result = await extractMemories({ persona, userId: ctx.user.id, locale: ctx.locale });
        return {
          extracted: result.added,
          skipped: result.skipped,
          // Whether the answer could be read — so the interface can say
          // "the model did not answer in the right shape" instead of
          // "0 extracted".
          readable: result.readable,
          // What the model returned that did not fit.
          trimmed: result.trimmed,
        };
      }),
  }),

  emotion: router({
    getReport: protectedProcedure
      .input(z.object({ personaId: z.number(), days: z.number().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getEmotionReport(input.personaId, ctx.user.id, input.days, ctx.user.timezone);
      }),

    getDailySnapshots: protectedProcedure
      .input(z.object({ personaId: z.number(), days: z.number().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getEmotionSnapshots(input.personaId, ctx.user.id, input.days, ctx.user.timezone);
      }),
  }),

  diary: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number(), limit: z.number().min(1).max(366).default(30) }))
      .query(async ({ ctx, input }) => getDiaryEntries(ctx.user.id, input.personaId, input.limit)),

    getByDate: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        /**
         * The day, as "YYYY-MM-DD".
         *
         * It is checked against the days that exist, and not only
         * against the shape of a date: "2026-02-30" has the right
         * shape and is not a day.
         */
        date: z.string().refine(isRealDayKey, { message: "Not a day." }),
      }))
      .query(async ({ ctx, input }) => getDiaryByDate(input.personaId, ctx.user.id, input.date)),

    /**
     * Whether a day has anything to write about.
     *
     * The page offered "write this day's diary" for every past day —
     * and the server always refused the days without messages, so the
     * user's only feedback was an error toast. The button is now only
     * offered when there is something to write from.
     */
    hasMessages: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        date: z.string().refine(isRealDayKey, { message: "Not a day." }),
      }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const timezone = await getUserTimezone(ctx.user.id);
        const rows = await getMessagesByDate(input.personaId, ctx.user.id, input.date, timezone);
        return { count: rows.length };
      }),

    getDates: protectedProcedure
      .input(z.object({ personaId: z.number().optional() }))
      .query(async ({ ctx, input }) => getDiaryDates(ctx.user.id, input.personaId)),

    generate: protectedProcedure.use(rateLimit(RATE_LIMITS.llmHeavy))
      .input(z.object({ personaId: z.number(), date: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        /**
         * The user's own calendar.
         *
         * "Today" was decided in UTC, so for anybody east of Greenwich
         * the app told them they could not write a diary for the day
         * they were living — and the messages of that morning were
         * filed under the previous day.
         */
        const timezone = await getUserTimezone(ctx.user.id);
        const date = input.date || previousDateKey(zonedDateKey(new Date(), timezone));
        /**
         * The date is a real day.
         *
         * It was only checked against a pattern, so "2026-02-30" was
         * accepted — a day that does not exist.
         */
        if (!isRealDayKey(date)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.invalidDateFormat") });
        }
        const today = zonedDateKey(new Date(), timezone);
        if (date > today) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.futureDiary") });
        }
        const existing = await getDiaryByDate(input.personaId, ctx.user.id, date);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: copy(ctx.locale, "errors.diaryExists") });
        const msgs = await getMessagesByDate(input.personaId, ctx.user.id, date, timezone);
        if (msgs.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.noMessagesThatDay") });
        const chatText = msgs.map(m => `${m.role === "user" ? copy(ctx.locale, "prompt.roleUser") : persona.name}: ${m.content || ""}`).join("\n");
        if (!chatText.trim()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.emptyMessagesThatDay") });
        }
        /**
         * The whole day, not the morning.
         *
         * The transcript was cut at six thousand characters — from the
         * start. So a busy day was written from its morning alone, and
         * the diary's "emotional arc" ended at lunchtime. The cut could
         * also land in the middle of a sentence, and the reader was
         * told nothing.
         *
         * So the head and the tail of the day are both kept, and the
         * prompt says when the middle was left out.
         */
        const DIARY_MAX_CHARS = 6000;
        const head = chatText.slice(0, Math.floor(DIARY_MAX_CHARS * 0.7));
        const tail = chatText.slice(-Math.floor(DIARY_MAX_CHARS * 0.3));
        const truncated = chatText.length > DIARY_MAX_CHARS;
        const diaryText = truncated
          ? `${head}\n\n${copy(ctx.locale, "prompts.diaryOmitted")}\n\n${tail}`
          : chatText;
        /**
         * The user's own provider.
         *
         * The diary is written from the user's own conversation of that
         * day. It was always written with the operator's provider — the
         * environment-configured one — so a user who had configured a
         * key of their own still had their private conversation sent to
         * the operator's account, and billed to the operator.
         */
        const { provider, owned } = await resolveProviderForUserWithOwnership({
          userId: ctx.user.id,
          providerName: persona.llmProvider ?? undefined,
        });
        const messages = [
          { role: "system" as const, content: copy(ctx.locale, "prompts.diaryWriting") },
          { role: "user" as const, content: diaryText },
        ];
        let response = "";
        if (provider) {
          response = await llmService.invokeWithProvider(provider, { messages });
        }
        if (!response.trim() && !owned) {
          // The operator's provider may only be used when the user has
          // no provider of their own.
          response = await llmService.invoke({ messages });
        }
        if (!response.trim()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.noProviderConfigured") });
        }
        const parsed = (extractJsonObject(response) ?? {}) as {
          summary?: string;
          highlights?: string[];
          emotionalArc?: Record<string, string>;
          quotes?: string[];
          reflection?: string | null;
        };
        /**
         * The write.
         *
         * The day is unique in the database now, so two generations
         * that passed the check together cannot both write — the second
         * one is told the day already has a diary, which is what the
         * check at the top of the procedure says.
         */
        let id: number;
        try {
          id = await createDiaryEntry({
            personaId: input.personaId, userId: ctx.user.id, date,
            summary: parsed.summary || copy(ctx.locale, "persona.diaryFallbackSummary"),
            highlights: parsed.highlights || [],
            emotionalArc: parsed.emotionalArc || {},
            quotes: parsed.quotes || [],
            reflection: parsed.reflection || null,
            messageCount: msgs.length,
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new TRPCError({ code: "CONFLICT", message: copy(ctx.locale, "errors.diaryAlreadyExists") });
          }
          throw error;
        }
        return { id };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // The entry was removed, or there was nothing there to remove.
        const removed = await deleteDiaryEntry(input.id, ctx.user.id);
        if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),
  }),

  /**
   * The crisis-support resources.
   *
   * The client shows them on the crisis card. They are served from the
   * same list the server quotes in a crisis reply, so the two can never
   * disagree about which number to call.
   */
  safety: router({
    // The resources are the same for everybody and contain nothing about
    // the user, so the crisis card can fetch them before sign-in too.
    resources: publicProcedure.query(async ({ ctx }) => ({
      resources: getCrisisResources().map((r) => ({
        id: r.id,
        region: ctx.locale === "en" ? r.regionEn ?? r.region : r.region,
        description: ctx.locale === "en" ? r.descriptionEn ?? r.description : r.description,
        contact: r.contact,
      })),
    })),

    /**
     * What the safety layer noticed.
     *
     * The events were written and then never shown to anybody: the app
     * noticed a crisis, a dependency or a worsening mood, recorded it,
     * and said nothing. A safety layer the user cannot see is not a safety
     * layer so much as a private log.
     */
    events: protectedProcedure
      .input(z.object({ limit: z.number().int().min(1).max(200).optional() }))
      .query(async ({ ctx, input }) => {
        const events = await getSafetyEvents(ctx.user.id, input.limit ?? 50);
        return {
          // How many there are in all — so the panel can say that what
          // it is showing is not everything.
          total: await countSafetyEvents(ctx.user.id),
          events: events.map((event) => ({
            id: event.id,
            type: event.type,
            severity: event.severity,
            personaId: event.personaId,
            handled: event.handled,
            createdAt: event.createdAt,
          })),
        };
      }),

    /**
     * Marks an event as dealt with.
     *
     * The user has seen it, which is all "handled" ever meant.
     */
    resolveEvent: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // The event was marked as dealt with, or there was nothing there.
        const resolved = await resolveSafetyEvent(input.id, ctx.user.id);
        if (!resolved) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),

    /**
     * How the app sees the relationship.
     *
     * The trajectory assessment is the only thing in the database that
     * reads the *user's* own language — the ratios of regret and
     * gratitude. It was computed, stored, and then hidden from the person
     * it was about.
     */
    assessments: protectedProcedure.query(async ({ ctx }) => {
      const personas = await getPersonasByUserId(ctx.user.id);
      /**
       * The newest assessment of each persona, in one query.
       *
       * It used to be one query per persona — so the trajectory page
       * made a round trip for every persona the user had.
       */
      const latest = await getLatestGraduationAssessments(ctx.user.id);
      const byPersona = new Map(latest.map((row) => [row.personaId, row]));
      const result = [];
      for (const persona of personas) {
        const assessment = byPersona.get(persona.id);
        if (!assessment) continue;
        result.push({
          personaId: persona.id,
          personaName: persona.name,
          trajectory: assessment.trajectory,
          regretRatio: assessment.regretRatio,
          gratitudeRatio: assessment.gratitudeRatio,
          note: (assessment.assessment as any)?.note ?? null,
          createdAt: assessment.createdAt,
        });
      }
      return { assessments: result };
    }),
  }),

  /**
   * What actually happened in the relationship.
   *
   * The app simulated a conversation and remembered the other person's
   * milestones, but it had nowhere to record reality: that they fought,
   * got back together, broke up, or are simply out of touch. The events
   * are the user's own record of their own life — the app does not guess
   * them, because guessing means inventing a relationship the user did
   * not have.
   */
  relationship: router({
    list: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        limit: z.number().int().min(1).max(200).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const events = await getRelationshipEvents(
          input.personaId,
          ctx.user.id,
          input.limit ?? 200,
        );
        return { events, phase: resolveRelationshipPhase(events) };
      }),

    add: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        kind: z.enum([
          "together", "apart", "reunion", "breakup", "conflict",
          "reconciliation", "news", "meetup", "triggered",
        ]),
        title: z.string().min(1).max(200),
        detail: z.string().max(2000).optional(),
        /**
         * When it happened.
         *
         * An ISO instant, or a day — "2024-03-14" — because that is
         * what a person knows about a moment ("we met that day"), and
         * the form asks for it in that shape.
         *
         * A day used to be impossible: the field wanted an ISO
         * *datetime*, so a date the user typed was refused, and the
         * event was recorded as "now" instead — which is a fact about
         * the record, not about what happened.
         */
        happenedAt: z.union([
          z.string().datetime(),
          /**
           * A day that exists.
           *
           * The shape was checked and not the day: "2026-02-30" was
           * accepted, and it rolled over to the second of March — so the
           * timeline showed a day the user never wrote down.
           */
          z.string().refine(isRealDayKey, { message: "Not a day." }),
        ]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        /**
         * The moment the event happened.
         *
         * A day is the middle of that day, in the user's own time —
         * so the date it is filed under is the day the user meant, and
         * not the day before it for anybody west of Greenwich.
         */
        const happenedAt = input.happenedAt
          ? (/^\d{4}-\d{2}-\d{2}$/.test(input.happenedAt)
            ? noonInTheUsersZone(input.happenedAt, ctx.user.timezone)
            : new Date(input.happenedAt))
          : undefined;
        const event = await createRelationshipEvent({
          userId: ctx.user.id,
          personaId: input.personaId,
          kind: input.kind,
          title: input.title,
          detail: input.detail ?? null,
          happenedAt,
        });

        /**
         * The text is scanned.
         *
         * The relationship timeline is where the user writes what
         * happened — "she said she wanted to die that night" — and it
         * was the other place the user could write freely that the
         * crisis detector never read.
         */
        const crisis = detectCrisis(`${input.title}\n${input.detail ?? ""}`);
        if (crisis.crisis) {
          await createSafetyEvent({
            userId: ctx.user.id,
            personaId: input.personaId,
            type: "crisis",
            severity: "critical",
          }).catch((e) => console.warn("[Safety] Failed to record the crisis event:", e));
        }

        // A breakup or a reunion changes the relationship itself, so the
        // persona's record is updated to match. The end date is what the
        // app uses to stop the anniversaries and to speak about the past
        // rather than the present.
        if (input.kind === "breakup" && !persona.togetherTo) {
          /**
           * The day it ended, in the user's own calendar.
           *
           * It was the UTC day: so a breakup at seven in the morning on
           * the first of January was recorded as the thirty-first of
           * December for anybody east of Greenwich. And that date is
           * what stops the anniversaries, marks the relationship as
           * over in the prompt, and switches the letter-reply register.
           */
          /**
           * The day it ended, in the user's own calendar.
           *
           * It was read as `new Date(input.happenedAt)` — which shadows
           * the moment computed above, and is midnight in *Greenwich*
           * for a day. So a breakup on the fourteenth was filed under the
           * thirteenth for anybody west of Greenwich, and that date is
           * what stops the anniversaries, marks the relationship as over
           * in the prompt, and switches the letter-reply register.
           */
          await updatePersona(input.personaId, ctx.user.id, {
            togetherTo: zonedDateKey(happenedAt ?? new Date(), ctx.user.timezone),
          });
        }
        if ((input.kind === "reunion" || input.kind === "reconciliation") && persona.togetherTo) {
          await updatePersona(input.personaId, ctx.user.id, { togetherTo: null });
        }

        return { success: true, event, crisis: crisis.crisis };
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const removed = await deleteRelationshipEvent(input.id, ctx.user.id);
        if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),
  }),

  /**
   * Letters.
   *
   * The app had one way to say something: talk to it, and get an answer.
   * But the things people most want to say to somebody they cannot reach
   * are the things they cannot say *to* them — and sometimes the answer
   * is the problem.
   *
   * A letter can be kept and never answered, or delivered. A delivered
   * letter is answered a day later, because instant replies are the one
   * thing that gives the game away.
   */
  letter: router({
    list: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        /**
         * The id of the oldest letter on the page.
         *
         * The list stopped at two hundred and there was no way to reach
         * the rest — the letters existed in the export and not in the
         * product.
         */
        before: z.number().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const letters = await getLetters(
          input.personaId,
          ctx.user.id,
          input.limit ?? 50,
          input.before,
        );
        // How many there are, not how many are shown.
        const total = await countLetters(input.personaId, ctx.user.id);
        return { letters, total };
      }),

    write: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        body: z.string().min(1).max(5000),
        /** How the user was feeling, if they said. */
        mood: z.string().max(16).optional(),
        /**
         * Whether the persona is allowed to answer it.
         *
         * A letter that is never delivered is a different act, and
         * sometimes it is the one that is wanted.
         */
        deliver: z.boolean().default(false),
        /**
         * "letter" is written to the persona. "todo" is 「等 TA 回来再说」
         * — a note kept for the moment the two of them are in touch
         * again.
         */
        kind: z.enum(["letter", "todo"]).default("letter"),
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        const { letter, asleep } = await writeLetter({
          persona,
          userId: ctx.user.id,
          body: input.body,
          mood: input.mood ?? null,
          deliver: input.kind === "todo" ? false : input.deliver,
          kind: input.kind,
        });

        /**
         * The letter is scanned.
         *
         * A letter is the most personal thing the app holds — it is
         * what a person writes when they cannot say it any other way.
         * And it was the one place the user could write freely that
         * the crisis detector never read *at the moment of writing*:
         * the only scan was at answer time, and a letter that is kept
         * — or written as a note to say later — is never answered.
         *
         * So "我不想活了" written into a letter was stored, never
         * looked at, and never shown to the person who wrote it.
         */
        const crisis = detectCrisis(input.body);
        if (crisis.crisis) {
          await createSafetyEvent({
            userId: ctx.user.id,
            personaId: input.personaId,
            type: "crisis",
            severity: "critical",
          }).catch((e: unknown) => console.warn("[Safety] Failed to record the crisis event:", e));
        }
        return { success: true, letter, asleep, crisis: crisis.crisis };
      }),

    /** The notes the user kept for later. */
    todos: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return {
          todos: await getWaitingNotes(input.personaId, ctx.user.id),
          // How many there are — so the interface can say that the list
          // is not everything.
          total: await countWaitingNotes(input.personaId, ctx.user.id),
        };
      }),

    remove: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const removed = await deleteLetter(input.id, ctx.user.id);
        if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),
  }),

  /**
   * The ruler.
   *
   * Everything else in this product is measured by whether it works.
   * This is the part that is measured by whether it is *still* the
   * person: one of their real lines is held back, and the rebuilt
   * persona has to say it again.
   */
  eval: router({
    /** Cuts a fresh set of held-out cases out of the imported records. */
    buildCases: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        const rows = await getCollectedMessagesForPersonaRows(input.personaId, ctx.user.id);
        const messages = rows.map((row) => ({
          id: row.id,
          role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: row.content,
          timestamp: row.timestamp ?? null,
        }));
        // The emotion is read in the language the records are in.
        const cases = buildEvalCases(messages, { locale: input.locale });
        const saved = await saveEvalCases(
          input.personaId,
          ctx.user.id,
          cases.map((item) => ({
            context: item.context,
            expected: item.expected,
            expectedState: item.expectedState,
            source: "collected",
            occurredAt: item.expected.timestamp ?? null,
          })),
        );
        return { saved };
      }),

    /** The cases that are currently held out. */
    listCases: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return { cases: await getEvalCases(input.personaId, ctx.user.id) };
      }),

    /**
     * Runs the cases and scores the answers.
     *
     * "withoutRules" is the control: the same persona, measured with its
     * rules switched off. A rule that does not move the numbers does not
     * belong in the prompt.
     */
    run: protectedProcedure
      .use(rateLimit(RATE_LIMITS.llmHeavy))
      .input(z.object({
        personaId: z.number(),
        variant: z.enum(["default", "withoutRules"]).default("default"),
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        /**
         * One run at a time.
         *
         * The rate limit allows ten a minute, and a run is up to
         * twelve model calls — so a double click started two runs,
         * wrote two rows, and left the comparison with the last run
         * depending on which of them finished last.
         */
        const runKey = `${ctx.user.id}:${input.personaId}:${input.variant}`;
        if (runningEvals.has(runKey)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: copy(input.locale, "errors.evalAlreadyRunning"),
          });
        }
        /**
         * The run is claimed here, before anything is awaited.
         *
         * It used to be claimed after the checks — so the comment
         * claimed there was "no `await` between the check and the
         * claim". There were four: the collected messages, the stored
         * cases, the saved cases and the run itself. So two requests
         * could both get past the check, and a double click started two
         * runs — twelve model calls each, twice the bill, two rows
         * written, and the comparison with the last run depending on
         * which of them finished last.
         *
         * The claim is here, and everything below is inside the try, so
         * a check that throws still gives the run back.
         */
        runningEvals.add(runKey);
        try {
          const rows = await getCollectedMessagesForPersonaRows(input.personaId, ctx.user.id);
          const messages = rows.map((row) => ({
            id: row.id,
            role: row.role === "assistant" ? ("assistant" as const) : ("user" as const),
            content: row.content,
            timestamp: row.timestamp ?? null,
          }));

          // The stored cases are the ones that get measured. Cutting a
          // fresh set every time would measure a different question each
          // time, and the comparison with the last run would be between
          // two different things.
          const stored = casesFromRows(await getEvalCases(input.personaId, ctx.user.id));
          const cases = stored.length
            ? stored
            : buildEvalCases(messages, { locale: input.locale });
          if (!cases.length) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: copy(input.locale, "labels.eval.noCases"),
            });
          }
          if (!stored.length) {
            // There were none stored, so these are new; they are kept, so
            // that the next run measures the same lines.
            await saveEvalCases(
              input.personaId,
              ctx.user.id,
              cases.map((item) => ({
                context: item.context,
                expected: item.expected,
                expectedState: item.expectedState,
                source: "collected",
                occurredAt: item.expected.timestamp ?? null,
              })),
            );
          }

          const metrics: Awaited<ReturnType<typeof runEval>> = await runEval({
            persona,
            userId: ctx.user.id,
            cases,
            trainingTexts: trainingTexts(messages, cases),
            variant: input.variant,
            locale: input.locale,
          });
          // The run is always kept. The comparison with the last run is
          // only meaningful if there is a last run — and the variant is
          // stored with it, because a run with the rules switched off is
          // a different persona and must not be compared against one with
          // them on.
          await saveEvalRun(input.personaId, ctx.user.id, {
            ...metrics,
            variant: input.variant,
          }, persona.personaData);
          return { metrics };
        } finally {
          runningEvals.delete(runKey);
        }
      }),

    /**
     * The last runs.
     *
     * Only the newest was exposed — so the comparison the panel exists
     * for could not be made.
     */
    list: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        limit: z.number().int().min(1).max(50).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const runs = await getEvalRuns(input.personaId, ctx.user.id, input.limit ?? 20);
        return { runs };
      }),

    /** The last run, and whether this one is worse than it. */
    latest: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const run = await getLatestEvalRun(input.personaId, ctx.user.id);
        return { run };
      }),
  }),

  /**
   * The rules the persona discriminates by.
   *
   * They are written into the persona's own data rather than kept in a
   * table of their own, because they are part of who the persona is —
   * the same place the catchphrases and the speaking style live.
   */
  microRule: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return { rules: normalizeMicroRules((persona.personaData as any)?.microRules) };
      }),

    /**
     * Mines the rules out of the imported records.
     *
     * The records are the only place the real words are: the app's own
     * conversation was written by the persona, so mining it would find
     * the persona's habits and call them the person's.
     *
     * What comes back are *candidates*. They carry the messages they
     * were read off, and they do not take effect until the user has
     * looked at them — a rule the model invented and the user never
     * checked is worse than no rule.
     */
    mine: protectedProcedure
      .use(rateLimit(RATE_LIMITS.llm))
      .input(z.object({
        personaId: z.number(),
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        /**
         * The mining and the saving take turns.
         *
         * Both are a read followed by a write — the rules that are
         * there now, plus the new ones, written back. So two runs at
         * once (two tabs, a double click) both read the same list, and
         * the second write undid the first one's work: the rules the
         * first run found were gone, and the user was told they had
         * been mined.
         *
         * And a save that landed between the mining's read and its
         * write was overwritten the same way.
         */
        return await withPersonaDataLock(input.personaId, async () => {
          const persona = await getPersonaById(input.personaId, ctx.user.id);
          if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

          const rows = await getCollectedMessagesForPersonaRows(input.personaId, ctx.user.id);
          const mined = await mineMicroRules({
            userId: ctx.user.id,
            locale: input.locale,
            messages: rows.map((row) => ({
              content: row.content,
              timestamp: row.timestamp,
              // In the collected records the other person is the assistant.
              role: row.role,
            })),
          });

          const existing = normalizeMicroRules((persona.personaData as any)?.microRules);
          const known = new Set(existing.map((rule) => rule.trigger.join("|")));
          // The id as well as the trigger: the same rule mined twice is
          // one rule, and the list must not hold two copies of it.
          const knownIds = new Set(existing.map((rule) => rule.id));
          const fresh = mined.filter(
            (rule) => !known.has(rule.trigger.join("|")) && !knownIds.has(rule.id),
          );
          const rules = normalizeMicroRules([...existing, ...fresh]);
          await updatePersona(input.personaId, ctx.user.id, {
            personaData: {
              ...((persona.personaData as any) || {}),
              microRules: rules,
            },
          });
          return { rules: fresh };
        });
      }),

    /**
     * Replaces the rules.
     *
     * A rule the user has deleted must not come back from the model, so
     * the whole list is replaced rather than merged.
     */
    save: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        rules: z.array(z.object({
          id: z.string().max(64).optional(),
          trigger: z.array(z.string().max(40)).min(1).max(12),
          meaning: z.string().min(1).max(500),
          rendering: z.string().min(1).max(500),
          confidence: z.number().min(0).max(1).default(0.5),
          source: z.enum(["auto", "manual"]).default("manual"),
          verified: z.boolean().default(true),
          evidence: z.array(z.object({
            at: z.string().max(40).optional(),
            snippet: z.string().max(1000),
          })).max(20).default([]),
        })).max(200),
      }))
      .mutation(async ({ ctx, input }) => {
        // The save and the mining take turns — see the note there.
        return await withPersonaDataLock(input.personaId, async () => {
          const persona = await getPersonaById(input.personaId, ctx.user.id);
          if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
          const rules = normalizeMicroRules(input.rules);
          const merged = {
            ...((persona.personaData as any) || {}),
            microRules: rules,
          };
          await updatePersona(input.personaId, ctx.user.id, { personaData: merged });
          return { rules };
        });
      }),
  }),

  /**
   * How the persona is imperfect in each state.
   *
   * It is separate from the realism level on purpose: the level says how
   * imperfect they are, and this says what that looks like when they are
   * happy and what it looks like when they are not.
   */
  imperfection: router({
    get: protectedProcedure
      .input(z.object({ personaId: z.number(), locale: z.enum(["zh", "en"]).default("zh") }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const stored = normalizeImperfectionProfile(
          (persona.personaData as any)?.imperfectionProfile,
          input.locale,
        );
        return {
          stored,
          merged: mergeImperfectionDefaults(stored, input.locale),
        };
      }),

    save: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        profile: z.array(z.object({
          state: z.enum(["warm", "playful", "nostalgic", "melancholy", "happy", "distant"]),
          deviations: z.array(z.string().max(200)).max(12),
        })).max(12),
      }))
      .mutation(async ({ ctx, input }) => {
        // The persona's fields are one column, so this is a read and a
        // write of the whole thing — see `withPersonaDataLock`. It used
        // to take no lock at all, so saving the profile while the rules
        // were being mined wrote the profile away.
        return await withPersonaDataLock(input.personaId, async () => {
          const persona = await getPersonaById(input.personaId, ctx.user.id);
          if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
          // The fallback for a state the user left empty is written in the
          // app's language — which is the user's language, not the app
          // default's.
          const profile = normalizeImperfectionProfile(input.profile, ctx.locale);
          const merged = {
            ...((persona.personaData as any) || {}),
            imperfectionProfile: profile,
          };
          await updatePersona(input.personaId, ctx.user.id, { personaData: merged });
          return { profile };
        });
      }),
  }),

  /**
   * The way out.
   *
   * The graduation ritual ends with a farewell written in the persona's
   * voice. But what was actually unfinished was the *user's* sentences —
   * the things they said here that they never managed to say to the
   * person they were talking about.
   *
   * So the goodbye has an exit as well as a door. The app collects those
   * words and hands them back; it never sends anything, and it never
   * writes anything on the user's behalf.
   */
  outbound: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return { letters: await getOutboundLetters(input.personaId, ctx.user.id) };
      }),

    /**
     * Looks through the conversation for the words that were only ever
     * said here.
     *
     * The candidates are the user's own messages, copied exactly. The
     * model's only job is to say which ones those are.
     */
    collect: protectedProcedure
      .use(rateLimit(RATE_LIMITS.llm))
      .input(z.object({
        personaId: z.number(),
        locale: z.enum(["zh", "en"]).default("zh"),
        max: z.number().min(1).max(20).default(5),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        /**
         * The whole conversation, not the last page of it.
         *
         * The words that were only ever said here are often from months
         * ago — and the reader took the newest five hundred, which at
         * twenty messages a day is about a month. So the older half of
         * the conversation was never read, while the comment claimed
         * otherwise.
         *
         * It is read in pages now, up to five thousand messages.
         */
        const messages = await getMessagesByPersonaIdPaged(input.personaId, ctx.user.id, {
          pageSize: 500,
          max: 5000,
        });
        const candidates = await collectOutboundCandidates({
          userId: ctx.user.id,
          personaId: input.personaId,
          messages: messages.map((row) => ({
            id: row.id,
            role: row.role === "assistant" ? "assistant" : "user",
            content: row.content,
            createdAt: row.createdAt,
          })),
          max: input.max,
          locale: input.locale,
          // The hour of the day is read in the persona's own zone: the
          // words someone says at two in the morning are a different
          // thing depending on whose two in the morning it is.
          timezone: (persona as any).timezone ?? null,
        });

        // Asking twice must not produce two copies of the same sentence.
        // The lines are collected from the conversation, and the
        // conversation does not change — so a line that is already on the
        // list is a line that has already been offered.
        const existing = await getOutboundLetters(input.personaId, ctx.user.id);
        const known = new Set(
          existing
            .map((letter) => letter.sourceMessageId)
            .filter((id): id is number => typeof id === "number"),
        );

        let saved = 0;
        for (const candidate of candidates.candidates) {
          if (known.has(candidate.messageId)) continue;
          await createOutboundLetter({
            userId: ctx.user.id,
            personaId: input.personaId,
            text: candidate.text,
            sourceMessageId: candidate.messageId,
            status: "ready",
          });
          known.add(candidate.messageId);
          saved += 1;
        }
        return { saved, note: candidates.note };
      }),

    /** "I said it." The app records it; it never sends it. */
    markSent: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const changed = await setOutboundLetterStatus(input.id, ctx.user.id, "sent");
        // A letter that is not there is not "done" — the interface would
        // otherwise show a success for something that never happened.
        if (!changed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),

    /**
     * "This one is for me."
     *
     * When the other person is not there any more, a letter written to
     * them has nowhere to go. Without somewhere for it to go, it would sit
     * in the list forever — which is the one outcome this feature exists
     * to prevent.
     */
    keepForSelf: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const changed = await setOutboundLetterStatus(input.id, ctx.user.id, "self");
        if (!changed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),

    /** "Never mind." Recorded rather than deleted: it is one of the two endings worth keeping. */
    drop: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const changed = await setOutboundLetterStatus(input.id, ctx.user.id, "dropped");
        if (!changed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),

    /**
     * Records that the letter was pointed out for having waited.
     *
     * The reminder is said once; this is the record of that.
     */
    markStaleNotified: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await markOutboundLetterStaleNotified(input.id, ctx.user.id);
        // Recording the reminder is best-effort: failing to write it
        // would mean the reminder is said again, which is not worth an
        // error the user cannot act on.
        return { success: true };
      }),

    updateText: protectedProcedure
      .input(z.object({ id: z.number(), text: z.string().min(1).max(5000) }))
      .mutation(async ({ ctx, input }) => {
        const changed = await updateOutboundLetterText(input.id, ctx.user.id, input.text);
        if (!changed) throw new TRPCError({ code: "NOT_FOUND" });
        return { success: true };
      }),
  }),

  /**
   * How this persona behaves over time.
   *
   * The delays used to be product rules. These are the persona's own
   * numbers, measured from the record, so the waiting is theirs rather
   * than the app's.
   */
  behavior: router({
    get: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const stored = await getPersonaBehaviorProfile(input.personaId, ctx.user.id);
        return { profile: normalizeBehaviorProfile(stored) };
      }),

    /** Measures it again, from whatever records exist now. */
    measure: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const profile = await measureAndSaveBehaviorProfile({
          personaId: input.personaId,
          userId: ctx.user.id,
          personaTimezone: (persona as any).timezone ?? null,
        });
        return { profile };
      }),
  }),

  scene: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const scenes = await getScenes(ctx.user.id);
      // A scene the app ships should read in the language the person is
      // reading. A scene they wrote themselves is left exactly as they
      // wrote it.
      return scenes.map((scene: any) => localizeScene(scene, ctx.locale));
    }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(100),
        /**
         * Bounded, like every other free-text field.
         *
         * The description and the overlay had no limit at all — and the
         * overlay is injected into every prompt built for a persona with
         * that scene active. So a pasted (or scripted) multi-megabyte
         * overlay silently became part of every system prompt, and the
         * provider started refusing the request.
         */
        description: z.string().max(2000).optional(),
        icon: z.string().max(10).optional(),
        systemPromptOverlay: z.string().max(20_000).optional(),
        // The scene's mood has to be one the persona's state machine knows,
        // otherwise the scene would put a word into the prompt that nothing
        // else understands.
        emotionalState: z.enum(["warm", "playful", "nostalgic", "melancholy", "happy", "distant"]).optional(),
        starters: z.array(z.string().max(500)).max(20).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        return createScene({ ...input, userId: ctx.user.id, starters: input.starters || [], isBuiltin: false });
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        // The delete itself is filtered by the owner, so somebody else's
        // scene is never touched — and a refusal is reported rather than a
        // success that did not happen.
        const deleted = await deleteScene(input.id, ctx.user.id);
        if (!deleted) {
          throw new TRPCError({ code: "FORBIDDEN", message: copy(ctx.locale, "errors.personaNotFound") });
        }
        return { success: true };
      }),

    activate: protectedProcedure
      .input(z.object({ personaId: z.number(), sceneId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        await activateScene(input.personaId, input.sceneId, ctx.user.id);
        return { success: true };
      }),

    deactivate: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        await activateScene(input.personaId, null, ctx.user.id);
        return { success: true };
      }),
  }),

  analytics: router({
    overview: protectedProcedure
      .input(z.object({ days: z.number().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        const [stats, messageVolume, emotionTimeline, personaEngagement, hourlyDistribution, moods] = await Promise.all([
          // Every chart of this answer is in the user's own calendar.
          // The volume chart already was; the streak, the active days
          // and the active hours were the server's — so one page showed
          // two different calendars.
          getAnalyticsStats(ctx.user.id, input.days, ctx.user.timezone),
          getMessageVolume(ctx.user.id, input.days, ctx.user.timezone),
          getEmotionTimeline(ctx.user.id, input.days, ctx.user.timezone),
          getPersonaEngagement(ctx.user.id, input.days, ctx.user.timezone),
          getHourlyDistribution(ctx.user.id, input.days, ctx.user.timezone),
          // The user's own states. The emotion timeline above is the
          // *persona's* mood, and the two are not the same thing.
          getUserMoods(ctx.user.id, input.days, ctx.user.timezone),
        ]);
        return { stats, messageVolume, emotionTimeline, personaEngagement, hourlyDistribution, moods };
      }),
  }),
});

export type AppRouter = typeof appRouter;
