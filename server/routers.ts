import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { requestAbortSignal } from "./_core/context";
import { extractMemories } from "./chat/memory-extract";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router, rateLimit } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { llmService, registry } from "./llm";
import type { InvokeParams, InvokeResult } from "./llm/types";
import { getTextContent } from "./llm/types";
import { invalidateUserProviderCache, resolveProviderForUser } from "./llm/user-provider";
import { storagePut } from "./storage";
import {
  createPersona, getPersonasByUserId, getPersonaById, updatePersona, deletePersona,
  getPersonasWithStats, getUserStats, getRecentActivity, getDailyChatCounts,
  createPersonaFile, getFilesByPersonaId,
  createMessage, getMessagesByPersonaId, clearMessagesByPersonaId, searchMessages,
  updateUserMessage, deleteMessage, deleteMessagesFrom, getPreviousMessage,
  getMessagesBefore, hasOlderMessages, searchAllMessages,
  createWechatBinding, getWechatBindingsByUserId, deleteWechatBinding, setWechatBindingPersona,
  getSkillJobById, updateSkillJob, getLlmConfigsByUserId, upsertLlmConfig, setDefaultLlmConfig, getDefaultLlmConfig,
  getResearchProfilesByPersonaId,
  updateUserProfile, updateUserPassword, deleteUserAccount, getAccountStats, exportUserData,
  getUserById, bumpUserTokenVersion, updateUserGraduationMode, updateUserTrajectoryAssessment,
  getUserTimezone,
  createMemory, getMemoriesByPersonaId, countMemories, getMemoryTitles, deleteMemory, updateMemory,
  setUserLocale, getUserLocale,  createEmotionSnapshot, getEmotionSnapshots, getEmotionReport, getTodaySnapshot,
  getCollectedMessagesForPersona,
  getIntimacyData, updateIntimacy,
  getMessageVolume, getEmotionTimeline, getPersonaEngagement, getHourlyDistribution, getAnalyticsStats,
  createDiaryEntry, getDiaryEntries, getDiaryByDate, deleteDiaryEntry, getMessagesByDate, getDiaryDates,
  getScenes, getSceneById, createScene, deleteScene, activateScene,
  getExportData, getRecentEmotionTrend, getMessageCountInRange, setGraduationStatus,
  getSafetyEvents, resolveSafetyEvent, getLatestGraduationAssessment,
  getChannelBindingsByUserId, getChannelBinding, setChannelBindingPersona,
  deleteChannelBinding, getChannelState, upsertChannelState,
  getUserTemplates, createUserTemplate, updateUserTemplate, deleteUserTemplate,
  createQuestionnaireAnswers, getActiveReminders, dismissReminder,
  appendPersonaCorrection,
  upsertUserMood, getUserMoods,
  createLetter, getLetters, getDueLetters, getLastLetterReplyAt,
  answerLetter, markLetterUnanswered, deleteLetter, getWaitingNotes,
  createRelationshipEvent, getRelationshipEvents, deleteRelationshipEvent,
  saveEvalCases, getEvalCases, saveEvalRun, getLatestEvalRun,
  getOutboundLetters, setOutboundLetterStatus, updateOutboundLetterText,
  markOutboundLetterStaleNotified,
  createOutboundLetter,
  getCollectedMessagesForPersona as getCollectedMessagesForPersonaRows,
  setPersonaBehaviorProfile, getPersonaBehaviorProfile,
} from "./db";
import { nanoid } from "nanoid";
import path from "path";
import { getBotStatus, startWeChatBot, stopWeChatBot, startLogin, submitVerifyCode, cancelLogin } from "./wechat/bot";
import { clearAllActivePersonas } from "./wechat/commands";
import { runSkillPipeline } from "./skill-engine/pipeline";
import { exportSkillToHost } from "./skill-engine/skill-export";
import { getEmotionalStateDesc, buildSystemPrompt, computeIntimacy, checkGraduationEligibility } from "./_core/persona-utils";
import { getEffectiveGraduationMode, getGraduationModeDetails, canOfferGraduation, getEffectivePresence } from "./_core/graduation";
import type { personas as personasTable } from "../drizzle/schema";
import type { DistillationMode } from "@shared/distillation-modes";
import { INTIMACY_LEVELS } from "@shared/intimacy";
import { inferEmotionalState } from "./_core/emotion";
import { getCrisisResources } from "./safety/resources";
import { isValidTimeZone, previousDateKey, zonedDateKey } from "@shared/timezone";
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
import { runConversation, clampContextLimit, clampTemperature, clampMaxTokens } from "./chat/service";
import { writeFarewellLetterWithStatus } from "./chat/farewell";
import { writeLetter } from "./chat/letters";
import { encryptSecret } from "./_core/crypto";
import { RATE_LIMITS } from "./_core/rate-limit";
import { sanitizeFileName, checkFileExtension } from "./_core/filename";
import { getSetupStatus } from "./bootstrap/setup-status";
import { getChannelAdapter, listChannels } from "./channels";
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
  enqueueCollectorJob,
  getCollector,
  getCollectorJob,
  listCollectorJobs,
} from "./collectors";
import { listPersistedCollectorJobs, collectedSpeaker } from "./collectors/db-store";

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
}): Promise<void> {
  const { personaId, userId, name } = params;
  const locale = params.locale ?? "zh";

  try {
    const files = await getFilesByPersonaId(personaId, userId);
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
    const collected = await getCollectedMessagesForPersona(personaId, userId);
    const collectedTranscript = collected.length > 0
      ? collected
          .map((m) => `${collectedSpeaker(m.role, locale)}${m.content}`)
          .join("\n")
      : "";

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
      // The prompts and the progress messages are written in the language
      // the person is using.
      locale,
    });
  } catch (e) {
    // The persona must never be left stuck in "pending" — the upload page
    // only surfaces progress for "analyzing" and errors for "error".
    console.error("[Persona] Distillation failed to start:", e);
    await updatePersona(personaId, userId, {
      analysisStatus: "error",
      analysisMessage: copy(locale, "persona.analysisFailed"),
    }).catch(() => {});
  }
}

/**
 * Rejects a provider name that is not registered.
 *
 * A typo would otherwise be stored silently, and every later chat would
 * quietly fall back to a different provider — the user would be talking to
 * a model they never chose. A custom endpoint is expressed by pointing a
 * registered provider (OpenAI, for instance) at a different `baseUrl`.
 */
function assertKnownProvider(providerName: string, locale: "zh" | "en" = "zh"): void {
  const known = registry.list().map((p) => p.name.toLowerCase());
  if (known.includes(providerName.trim().toLowerCase())) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: copy(locale, "errors.unknownProvider", { provider: providerName }),
  });
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
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
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
        const mood = await upsertUserMood({
          userId: ctx.user.id,
          date,
          mood: input.mood,
          note: input.note ?? null,
        });
        return { success: true, mood };
      }),

    /** The user's own moods, oldest first. */
    moods: protectedProcedure
      .input(z.object({ days: z.number().int().min(1).max(365).optional() }))
      .query(async ({ ctx, input }) => {
        return getUserMoods(ctx.user.id, input.days ?? 30);
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
        // A password change signs every other device out.
        await bumpUserTokenVersion(ctx.user.id);
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
        await deleteUserAccount(ctx.user.id);
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
        return { success: true };
      }),
  }),

  persona: router({
    list: protectedProcedure.query(async ({ ctx }) => getPersonasWithStats(ctx.user.id)),

    stats: protectedProcedure.query(async ({ ctx }) => getUserStats(ctx.user.id)),

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
        togetherFrom: z.string().max(50).optional(),
        togetherTo: z.string().max(50).optional(),
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
        togetherFrom: z.string().max(50).nullable().optional(),
        togetherTo: z.string().max(50).nullable().optional(),
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
        await updatePersona(id, ctx.user.id, data);
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
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const merged = { ...((persona.personaData as any) || {}), ...input.personaData };
        await updatePersona(input.id, ctx.user.id, { personaData: merged });
        return { success: true };
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
        const prompt = await buildPromptForPersona({
          persona,
          userId: ctx.user.id,
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
      .input(z.object({
        id: z.number(),
        correction: z.string().min(1).max(2000),
      }))
      .mutation(async ({ ctx, input }) => {
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

        const result = await applyPersonaCorrection({
          name: persona.name,
          characterFamily: "relationship",
          personaData: persona.personaData as any,
          correction: input.correction,
          provider: (persona as any).llmProvider || undefined,
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
        return { status: persona.analysisStatus, progress: persona.analysisProgress, message: persona.analysisMessage };
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
        startPersonaDistillation({
          locale: ctx.locale,
          personaId: input.id,
          userId: ctx.user.id,
          name: persona.name,
          characterFamily: input.characterFamily,
          researchProfile: input.researchProfile ?? null,
          mode: input.mode ?? null,
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
        const recentEmotions = await getRecentEmotionTrend(input.id, ctx.user.id, 14);
        const recentFreq = await getMessageCountInRange(input.id, ctx.user.id, 7, 0);
        const prevFreq = await getMessageCountInRange(input.id, ctx.user.id, 14, 7);
        const result = checkGraduationEligibility({
          intimacyLevel: persona.intimacyLevel,
          recentEmotions,
          chatCount: persona.chatCount,
          recentChatFrequency: recentFreq,
          previousChatFrequency: prevFreq,
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
        fileType: z.enum(["chat_txt", "chat_csv", "image", "video"]),
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
        return rows.map((m: any) => ({
          ...m,
          recalled: parseRecalledIds(m.recalledMemoryIds).map((id: number) => ({
            id,
            title: titles.get(id) ?? "",
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

        const previous = await getPreviousMessage(input.personaId, ctx.user.id, input.messageId);
        if (!previous || previous.role !== "user") {
          throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.messageNotFound") });
        }

        const removed = await deleteMessagesFrom(previous.id, input.personaId, ctx.user.id);
        if (removed === 0) throw new TRPCError({ code: "BAD_REQUEST", message: copy(ctx.locale, "errors.messageNotFound") });

        let reply = "";
        let emotionalState: string = persona.emotionalState;
        for await (const event of runConversation({
          persona,
          userId: ctx.user.id,
          message: previous.content,
          providerName: (persona as any).llmProvider || undefined,
          mode: "once",
          locale: input.locale,
          signal: requestAbortSignal(ctx.req, ctx.res),
        })) {
          if (event.type === "delta") reply += event.text;
          else if (event.type === "emotion") emotionalState = event.state;
        }
        return { reply, emotionalState };
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
        const updated = await updateUserMessage(input.messageId, ctx.user.id, input.content);
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
        const deleted = await deleteMessage(input.messageId, ctx.user.id);
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
          else if (event.type === "done") {
            graduationSuggested = event.graduationSuggested;
            careNote = event.careNote;
            crisis = event.crisis;
          }
        }

        return { reply, emotionalState, graduationSuggested, careNote, crisis };
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
          else if (event.type === "done") {
            graduationSuggested = event.graduationSuggested;
            careNote = event.careNote;
            crisis = event.crisis;
          }
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
        const transcriptionRequest = [{
          role: "user" as const,
          content: copy(ctx.locale, "prompts.voiceTranscription", { duration: input.duration }),
        }];
        const transcription = (voiceProvider
          ? await voiceProvider.invoke(transcriptionRequest).catch(() => "")
          : await llmService.invoke({ messages: transcriptionRequest }).catch(() => "")
        ) || copy(ctx.locale, "prompt.voicePlaceholder");

        let reply = "";
        let emotionalState: string = persona.emotionalState;
        let graduationSuggested = false;
        let careNote = null;
        let crisis = false;

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
          else if (event.type === "done") {
            graduationSuggested = event.graduationSuggested;
            careNote = event.careNote;
            crisis = event.crisis;
          }
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
        return { voices: voicesForLocale(input.locale) };
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
        const html = generateChatExportHTML({
          persona: data.persona,
          messages: data.messages,
          memories: data.memories,
          emotionSnapshots: data.emotionSnapshots,
          diaryEntries: data.diaryEntries,
          letters: data.letters,
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
      clearAllActivePersonas();
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
        await deleteWechatBinding(input.id, ctx.user.id);
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
        appId: z.string().min(1).max(128),
        appSecret: z.string().min(1).max(256),
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

    unbind: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteChannelBinding(input.id, ctx.user.id);
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
        await updateUserTemplate(input.id, ctx.user.id, data as any);
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteUserTemplate(input.id, ctx.user.id);
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
        const systemPrompt = buildSystemPrompt(persona);

        // The opening lines come from the persona's scene, so the card starts
        // the conversation the way the app does.
        const scenes = await getScenes(ctx.user.id);
        const scene = scenes.find(
          (s) => Array.isArray(s.starters) && (s.starters as string[]).length > 0,
        );

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
        await dismissReminder(input.id, ctx.user.id);
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

        const all = await getCollectedMessagesForPersona(input.personaId, ctx.user.id);
        const filtered = input.source
          ? all.filter((m) => m.source === input.source)
          : all;

        return {
          total: filtered.length,
          sources: Array.from(new Set(all.map((m) => m.source))),
          messages: filtered
            .slice(-input.limit)
            .reverse()
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

        const handle = await enqueueCollectorJob({
          userId: String(ctx.user.id),
          personaId: String(input.personaId),
          source: input.source,
          input: {
            target: input.target,
            limit: input.limit,
          },
        });
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

        const collectInput = { target: input.target } as any;

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
        await saveConnectorSource({
          userId: ctx.user.id,
          connector,
          input: collectInput,
          authState,
        }).catch((e) => {
          console.warn("[Collectors] Could not store the source:", e);
        });

        return { authState };
      }),

    /** The sources the user has already authorised. */
    listAuthorizedSources: protectedProcedure.query(async ({ ctx }) => {
      const { listCollectionSources } = await import("./collectors/db-store");
      const sources = await listCollectionSources(ctx.user.id).catch(() => []);
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

    /** Reports the progress of one job. */
    getJob: protectedProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ ctx, input }) => {
        const job = getCollectorJob(input.jobId);
        if (!job || job.userId !== String(ctx.user.id)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
        return {
          id: job.id,
          source: job.source,
          status: job.status,
          progress: job.progress,
          messageCount: job.messageCount,
          error: job.error,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
        };
      }),
  }),

  skillEngine: router({
    startPipeline: protectedProcedure
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

        startPersonaDistillation({
          locale: ctx.locale,
          personaId: input.personaId,
          userId: ctx.user.id,
          name: persona.name,
          characterFamily: input.characterFamily,
          researchProfile: input.researchProfile ?? null,
          mode: input.mode ?? null,
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
            message: e instanceof Error ? e.message : copy(ctx.locale, "errors.skillExportFailed"),
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
        extraConfig: config.extraConfig,
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
        extraConfig: config.extraConfig,
        hasKey: !!config.apiKey,
        apiKeyHint: config.apiKeyHint ?? null,
      };
    }),

    listProviders: protectedProcedure.query(() => registry.list()),

    upsert: protectedProcedure
      .input(z.object({
        providerName: z.string().min(1),
        apiKey: z.string().max(512).optional(),
        baseUrl: z.string().max(512).optional(),
        model: z.string().max(128).optional(),
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
        const payload: Parameters<typeof upsertLlmConfig>[1] = { ...rest };

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
      .input(z.object({ extraConfig: z.record(z.string(), z.any()) }))
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
        await setDefaultLlmConfig(ctx.user.id, input.providerName);
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
        date: z.string().max(50).optional(),
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
        date: z.string().max(50).nullable().optional(),
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
        await deleteMemory(input.id, ctx.user.id);
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
        return { extracted: result.added, skipped: result.skipped };
      }),
  }),

  emotion: router({
    getReport: protectedProcedure
      .input(z.object({ personaId: z.number(), days: z.number().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getEmotionReport(input.personaId, ctx.user.id, input.days);
      }),

    getDailySnapshots: protectedProcedure
      .input(z.object({ personaId: z.number(), days: z.number().min(1).max(365).default(30) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getEmotionSnapshots(input.personaId, ctx.user.id, input.days);
      }),
  }),

  diary: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number(), limit: z.number().min(1).max(366).default(30) }))
      .query(async ({ ctx, input }) => getDiaryEntries(ctx.user.id, input.personaId, input.limit)),

    getByDate: protectedProcedure
      .input(z.object({ personaId: z.number(), date: z.string() }))
      .query(async ({ ctx, input }) => getDiaryByDate(input.personaId, ctx.user.id, input.date)),

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
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
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
        const response = await llmService.invoke({
          messages: [
            { role: "system", content: copy(ctx.locale, "prompts.diaryWriting") },
            { role: "user", content: chatText.slice(0, 6000) },
          ],
        });
        const parsed = (extractJsonObject(response) ?? {}) as {
          summary?: string;
          highlights?: string[];
          emotionalArc?: Record<string, string>;
          quotes?: string[];
          reflection?: string | null;
        };
        const id = await createDiaryEntry({
          personaId: input.personaId, userId: ctx.user.id, date,
          summary: parsed.summary || copy(ctx.locale, "persona.diaryFallbackSummary"),
          highlights: parsed.highlights || [],
          emotionalArc: parsed.emotionalArc || {},
          quotes: parsed.quotes || [],
          reflection: parsed.reflection || null,
          messageCount: msgs.length,
        });
        return { id };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteDiaryEntry(input.id, ctx.user.id);
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
        await resolveSafetyEvent(input.id, ctx.user.id);
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
      const result = [];
      for (const persona of personas) {
        const latest = await getLatestGraduationAssessment(persona.id, ctx.user.id);
        if (!latest) continue;
        result.push({
          personaId: persona.id,
          personaName: persona.name,
          trajectory: latest.trajectory,
          regretRatio: latest.regretRatio,
          gratitudeRatio: latest.gratitudeRatio,
          note: (latest.assessment as any)?.note ?? null,
          createdAt: latest.createdAt,
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
          input.limit ?? 50,
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
        /** When it happened, as an ISO date. Defaults to now. */
        happenedAt: z.string().datetime().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        const event = await createRelationshipEvent({
          userId: ctx.user.id,
          personaId: input.personaId,
          kind: input.kind,
          title: input.title,
          detail: input.detail ?? null,
          happenedAt: input.happenedAt ? new Date(input.happenedAt) : undefined,
        });

        // A breakup or a reunion changes the relationship itself, so the
        // persona's record is updated to match. The end date is what the
        // app uses to stop the anniversaries and to speak about the past
        // rather than the present.
        if (input.kind === "breakup" && !persona.togetherTo) {
          await updatePersona(input.personaId, ctx.user.id, {
            togetherTo: (input.happenedAt ? new Date(input.happenedAt) : new Date())
              .toISOString().slice(0, 10),
          });
        }
        if ((input.kind === "reunion" || input.kind === "reconciliation") && persona.togetherTo) {
          await updatePersona(input.personaId, ctx.user.id, { togetherTo: null });
        }

        return { success: true, event };
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
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const letters = await getLetters(input.personaId, ctx.user.id);
        return { letters };
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

        const letter = await writeLetter({
          persona,
          userId: ctx.user.id,
          body: input.body,
          mood: input.mood ?? null,
          deliver: input.kind === "todo" ? false : input.deliver,
          kind: input.kind,
          locale: input.locale,
        });
        return { success: true, letter };
      }),

    /** The notes the user kept for later. */
    todos: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return { todos: await getWaitingNotes(input.personaId, ctx.user.id) };
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

        const metrics = await runEval({
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
        const fresh = mined.filter((rule) => !known.has(rule.trigger.join("|")));
        const rules = normalizeMicroRules([...existing, ...fresh]);
        await updatePersona(input.personaId, ctx.user.id, {
          personaData: {
            ...((persona.personaData as any) || {}),
            microRules: rules,
          },
        });
        return { rules: fresh };
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
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const rules = normalizeMicroRules(input.rules);
        const merged = {
          ...((persona.personaData as any) || {}),
          microRules: rules,
        };
        await updatePersona(input.personaId, ctx.user.id, { personaData: merged });
        return { rules };
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

        // The whole conversation, not the last page of it: the words
        // that were only ever said here are often from months ago.
        const messages = await getMessagesByPersonaId(input.personaId, ctx.user.id, 500);
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
        description: z.string().optional(),
        icon: z.string().max(10).optional(),
        systemPromptOverlay: z.string().optional(),
        // The scene's mood has to be one the persona's state machine knows,
        // otherwise the scene would put a word into the prompt that nothing
        // else understands.
        emotionalState: z.enum(["warm", "playful", "nostalgic", "melancholy", "happy", "distant"]).optional(),
        starters: z.array(z.string()).optional(),
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
          getAnalyticsStats(ctx.user.id, input.days),
          getMessageVolume(ctx.user.id, input.days, ctx.user.timezone),
          getEmotionTimeline(ctx.user.id, input.days),
          getPersonaEngagement(ctx.user.id, input.days),
          getHourlyDistribution(ctx.user.id, input.days),
          // The user's own states. The emotion timeline above is the
          // *persona's* mood, and the two are not the same thing.
          getUserMoods(ctx.user.id, input.days),
        ]);
        return { stats, messageVolume, emotionTimeline, personaEngagement, hourlyDistribution, moods };
      }),
  }),
});

export type AppRouter = typeof appRouter;
