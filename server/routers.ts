import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
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
  createWechatBinding, getWechatBindingsByUserId, deleteWechatBinding, setWechatBindingPersona,
  getSkillJobById, updateSkillJob, getLlmConfigsByUserId, upsertLlmConfig, setDefaultLlmConfig, getDefaultLlmConfig,
  getResearchProfilesByPersonaId,
  updateUserProfile, updateUserPassword, deleteUserAccount, getAccountStats, exportUserData,
  getUserById, bumpUserTokenVersion,
  createMemory, getMemoriesByPersonaId, deleteMemory,  createEmotionSnapshot, getEmotionSnapshots, getEmotionReport, getTodaySnapshot,
  getCollectedMessagesForPersona,
  getIntimacyData, updateIntimacy,
  getMessageVolume, getEmotionTimeline, getPersonaEngagement, getHourlyDistribution, getAnalyticsStats,
  createDiaryEntry, getDiaryEntries, getDiaryByDate, deleteDiaryEntry, getMessagesByDate, getDiaryDates,
  getScenes, getSceneById, createScene, deleteScene, activateScene,
  getExportData, getRecentEmotionTrend, getMessageCountInRange, setGraduationStatus,
  getChannelBindingsByUserId, getChannelBinding, setChannelBindingPersona,
  deleteChannelBinding, getChannelState, upsertChannelState,
  getUserTemplates, createUserTemplate, updateUserTemplate, deleteUserTemplate,
  createQuestionnaireAnswers, getActiveReminders, dismissReminder,
  appendPersonaCorrection,
} from "./db";
import { nanoid } from "nanoid";
import path from "path";
import { getBotStatus, startWeChatBot, stopWeChatBot, startLogin, submitVerifyCode, cancelLogin } from "./wechat/bot";
import { clearAllActivePersonas } from "./wechat/commands";
import { runSkillPipeline } from "./skill-engine/pipeline";
import { exportSkillToHost } from "./skill-engine/skill-export";
import { getEmotionalStateDesc, buildSystemPrompt, computeIntimacy, checkGraduationEligibility } from "./_core/persona-utils";
import { INTIMACY_LEVELS } from "@shared/intimacy";
import { inferEmotionalState } from "./_core/emotion";
import { hashPassword, verifyPassword } from "./_core/password";
import { extractJsonArray, extractJsonObject } from "./_core/json";
import { runConversation } from "./chat/service";
import { encryptSecret } from "./_core/crypto";
import { RATE_LIMITS } from "./_core/rate-limit";
import { sanitizeFileName, checkFileExtension } from "./_core/filename";
import { getSetupStatus } from "./bootstrap/setup-status";
import { getChannelAdapter, listChannels } from "./channels";
import { feishuAdapter } from "./channels/feishu";
import { getBuiltinTemplates } from "./templates";
import { normalizeTemplate, validateTemplate, type PersonaTemplate } from "./templates/schema";
import { buildPersonaFromAnswers } from "./templates/questionnaire";
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
import { listPersistedCollectorJobs } from "./collectors/db-store";

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
}): Promise<void> {
  const { personaId, userId, name, characterFamily } = params;

  try {
    const files = await getFilesByPersonaId(personaId, userId);
    const chatContent = files
      .filter((f) => f.fileType === "chat_txt" || f.fileType === "chat_csv")
      .map((f) => f.extractedMemory || "")
      .join("\n\n---\n\n");
    const imageUrls = files
      .filter((f) => f.fileType === "image")
      .map((f) => f.fileUrl)
      .filter(Boolean);

    // Messages pulled in by the collectors are part of the history too.
    const collected = await getCollectedMessagesForPersona(personaId, userId);
    const collectedTranscript = collected.length > 0
      ? collected
          .map((m) => `${m.role === "user" ? "我" : "TA"}：${m.content}`)
          .join("\n")
      : "";

    await updatePersona(personaId, userId, {
      analysisStatus: "analyzing",
      analysisProgress: 5,
      analysisMessage: "启动性格蒸馏引擎...",
    });

    await runSkillPipeline({
      personaId,
      userId,
      characterFamily,
      name,
      chatContent: [chatContent, collectedTranscript].filter(Boolean).join("\n\n---\n\n"),
      imageUrls,
      researchProfile: params.researchProfile ?? undefined,
    });
  } catch (e) {
    // The persona must never be left stuck in "pending" — the upload page
    // only surfaces progress for "analyzing" and errors for "error".
    console.error("[Persona] Distillation failed to start:", e);
    await updatePersona(personaId, userId, {
      analysisStatus: "error",
      analysisMessage: "解析失败，请重试",
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
function assertKnownProvider(providerName: string): void {
  const known = registry.list().map((p) => p.name.toLowerCase());
  if (known.includes(providerName.trim().toLowerCase())) return;
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `未知的 LLM 提供商：${providerName}`,
  });
}

export const appRouter = router({
  system: systemRouter,

  /** Public probe used by the first-run wizard. */
  setup: publicProcedure.query(() => getSetupStatus()),

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
      };
    }),

    updateProfile: protectedProcedure
      .input(z.object({ name: z.string().min(1).max(100).optional(), email: z.string().email().max(320).optional() }))
      .mutation(async ({ ctx, input }) => {
        await updateUserProfile(ctx.user.id, input);
        return { success: true };
      }),

    changePassword: protectedProcedure
      .input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6).max(128) }))
      .mutation(async ({ ctx, input }) => {
        const user = await getUserById(ctx.user.id);
        if (!user || !user.passwordHash) throw new TRPCError({ code: "BAD_REQUEST", message: "无法修改密码" });
        const valid = await verifyPassword(input.currentPassword, user.passwordHash);
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "当前密码错误" });
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
        if (!valid) throw new TRPCError({ code: "UNAUTHORIZED", message: "密码错误" });
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

    dailyActivity: protectedProcedure.query(async ({ ctx }) => getDailyChatCounts(ctx.user.id)),

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
        const result = buildPersonaFromAnswers(input.answers);

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
          analysisMessage: "由问卷创建",
        });

        await createQuestionnaireAnswers({
          personaId,
          userId: ctx.user.id,
          answers: input.answers as any,
        });

        return { personaId };
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(100),
        relationshipDesc: z.string().max(200).optional(),
        togetherFrom: z.string().max(50).optional(),
        togetherTo: z.string().max(50).optional(),
        // Where the persona came from. "upload" is the default — the persona
        // is built from uploaded chat logs.
        source: z.enum(["upload", "questionnaire", "card"]).default("upload"),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await createPersona({ userId: ctx.user.id, ...input, analysisStatus: "pending" });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number(), name: z.string().min(1).max(100).optional(), relationshipDesc: z.string().max(200).optional(), togetherFrom: z.string().max(50).optional(), togetherTo: z.string().max(50).optional(), emotionalState: z.enum(["warm","playful","nostalgic","melancholy","happy","distant"]).optional(), llmProvider: z.string().max(64).optional(), remindersEnabled: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        // A persona that points at a provider that does not exist would
        // silently talk to a different model.
        if (data.llmProvider) assertKnownProvider(data.llmProvider);
        await updatePersona(id, ctx.user.id, data);
        return { success: true };
      }),

    updatePersonaData: protectedProcedure
      .input(z.object({ id: z.number(), personaData: z.record(z.string(), z.any()) }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const merged = { ...((persona.personaData as any) || {}), ...input.personaData };
        await updatePersona(input.id, ctx.user.id, { personaData: merged });
        return { success: true };
      }),

    getSystemPrompt: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return { prompt: buildSystemPrompt(persona) };
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
          throw new TRPCError({ code: "BAD_REQUEST", message: "这个分身还没有完成解析" });
        }

        // The correction is a stage of its own: it changes the persona, and
        // a consumer of `skill_jobs.pipeline_stage` has to be able to see
        // that happening.
        const jobId = (persona as any).skillJobId ?? null;
        if (jobId) {
          await updateSkillJob(jobId, ctx.user.id, {
              pipelineStage: "correcting",
              stageMessage: "正在按你的修正更新人设...",
            })
            .catch(() => undefined);
        }

        const result = await applyPersonaCorrection({
          name: persona.name,
          characterFamily: "relationship",
          personaData: persona.personaData as any,
          correction: input.correction,
          provider: (persona as any).llmProvider || undefined,
        });

        if (!result) {
          if (jobId) {
            await updateSkillJob(jobId, ctx.user.id, { pipelineStage: "complete" })
              .catch(() => undefined);
          }
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "没能理解这次修正，请说得更具体一些",
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

        await updatePersona(input.id, ctx.user.id, {
          personaData: result.personaData as any,
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
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        startPersonaDistillation({
          personaId: input.id,
          userId: ctx.user.id,
          name: persona.name,
          characterFamily: input.characterFamily,
          researchProfile: input.researchProfile ?? null,
        }).catch((e) => console.error("[triggerAnalysis] error:", e));
        return { success: true };
      }),

    checkGraduation: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.graduationStatus === "graduated") {
          return { eligible: false, status: "graduated" as const, farewellLetter: persona.farewellLetter };
        }
        if (persona.graduationStatus === "suggested") {
          return { eligible: true, status: "suggested" as const, farewellLetter: null };
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
        if (result.eligible && !persona.graduationStatus) {
          await setGraduationStatus(input.id, ctx.user.id, "suggested");
        }
        return { eligible: result.eligible, status: (persona.graduationStatus || null) as string | null, reason: result.reason, farewellLetter: null };
      }),

    graduate: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const systemPrompt = buildSystemPrompt(persona);
        const response = await llmService.invoke({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `我们已经走过了很长的路，现在是时候说再见了。请用${persona.name}的口吻，写一封温暖的告别信。回顾我们的美好时光，表达祝福和不舍。信的长度在200-400字之间。只返回信的内容，不要有其他文字。` },
          ],
        });
        const farewellLetter = response || `亲爱的，感谢你一路的陪伴。虽然我们要说再见了，但那些美好的回忆会永远留在心里。祝你一切都好。—— ${persona.name}`;
        await setGraduationStatus(input.id, ctx.user.id, "graduated", farewellLetter);
        return { farewellLetter };
      }),

    declineGraduation: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await setGraduationStatus(input.id, ctx.user.id, "declined");
        return { success: true };
      }),

    awaken: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.graduationStatus !== "graduated") throw new TRPCError({ code: "BAD_REQUEST", message: "该分身未毕业" });
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
          throw new TRPCError({ code: "BAD_REQUEST", message: "文件太大" });
        }
        const safeName = sanitizeFileName(input.fileName);
        const extensionProblem = checkFileExtension(safeName, input.fileType);
        if (extensionProblem) {
          throw new TRPCError({ code: "BAD_REQUEST", message: extensionProblem });
        }
        const fileKey = `personas/${ctx.user.id}/${input.personaId}/${nanoid()}-${safeName}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        let extractedText: string | undefined;
        if (input.fileType === "chat_txt" || input.fileType === "chat_csv") {
          extractedText = buffer.toString("utf-8").slice(0, 50000);
        }
        const fileId = await createPersonaFile({ personaId: input.personaId, userId: ctx.user.id, fileType: input.fileType, originalName: safeName, fileKey, fileUrl: url, fileSize: buffer.length, extractedMemory: extractedText?.slice(0, 2000), processStatus: "done" });
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
      .input(z.object({ personaId: z.number(), limit: z.number().min(1).max(200).default(50) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getMessagesByPersonaId(input.personaId, ctx.user.id, input.limit);
      }),

    send: protectedProcedure.use(rateLimit(RATE_LIMITS.llm))
      .input(z.object({
        personaId: z.number(),
        message: z.string().min(1).max(2000),
        // The interface language. It decides which emotion triggers the
        // heuristic uses and which language the prompt is written in.
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "分身还未准备好，请先完成 AI 解析" });

        let reply = "";
        let emotionalState: string = persona.emotionalState;
        let graduationSuggested = false;
        let careNote = null;

        for await (const event of runConversation({
          persona,
          userId: ctx.user.id,
          message: input.message,
          providerName: (persona as any).llmProvider || undefined,
          mode: "once",
          locale: input.locale,
        })) {
          if (event.type === "delta") reply += event.text;
          else if (event.type === "emotion") emotionalState = event.state;
          else if (event.type === "done") {
            graduationSuggested = event.graduationSuggested;
            careNote = event.careNote;
          }
        }

        return { reply, emotionalState, graduationSuggested, careNote };
      }),

    sendImage: protectedProcedure.use(rateLimit(RATE_LIMITS.llm))
      .input(z.object({
        personaId: z.number(),
        imageContent: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "分身还未准备好" });

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
            message: `当前模型 ${provider.name} 不支持图片理解，请更换模型或改用文字描述`,
          });
        }

        const buffer = Buffer.from(input.imageContent, "base64");
        const safeName = sanitizeFileName(input.fileName);
        const fileKey = `chat/${ctx.user.id}/${input.personaId}/${nanoid()}-${safeName}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);

        let reply = "";
        let emotionalState: string = persona.emotionalState;
        let graduationSuggested = false;

        for await (const event of runConversation({
          persona,
          userId: ctx.user.id,
          message: "[图片]",
          providerName,
          mode: "once",
          locale: input.locale,
          media: { url, type: "image", mimeType: input.mimeType },
        })) {
          if (event.type === "delta") reply += event.text;
          else if (event.type === "emotion") emotionalState = event.state;
          else if (event.type === "done") graduationSuggested = event.graduationSuggested;
        }

        return { reply, emotionalState, imageUrl: url, graduationSuggested };
      }),

    sendVoice: protectedProcedure.use(rateLimit(RATE_LIMITS.llm))
      .input(z.object({
        personaId: z.number(),
        audioContent: z.string(),
        duration: z.number(),
        fileName: z.string(),
        locale: z.enum(["zh", "en"]).default("zh"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "分身还未准备好" });

        const buffer = Buffer.from(input.audioContent, "base64");
        const safeName = sanitizeFileName(input.fileName);
        const fileKey = `chat/${ctx.user.id}/${input.personaId}/${nanoid()}-${safeName}`;
        const { url } = await storagePut(fileKey, buffer, "audio/webm");

        const transcription = await llmService.invoke({
          messages: [{ role: "user", content: `请将以下语音消息转写为文字。如果无法转写，请根据上下文猜测可能的内容。语音时长：${input.duration}秒` }],
        }) || "（语音消息）";

        let reply = "";
        let emotionalState: string = persona.emotionalState;
        let graduationSuggested = false;

        for await (const event of runConversation({
          persona,
          userId: ctx.user.id,
          message: transcription,
          providerName: (persona as any).llmProvider || undefined,
          mode: "once",
          locale: input.locale,
          media: { url, type: "voice" },
        })) {
          if (event.type === "delta") reply += event.text;
          else if (event.type === "emotion") emotionalState = event.state;
          else if (event.type === "done") graduationSuggested = event.graduationSuggested;
        }

        return { reply, emotionalState, transcription, voiceUrl: url, graduationSuggested };
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

    tts: protectedProcedure.use(rateLimit(RATE_LIMITS.llm))
      .input(z.object({ text: z.string().min(1).max(500), voice: z.string().max(64).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { generateTTS } = await import("./_core/tts");
        const audioUrl = await generateTTS(input.text, input.voice, ctx.user.id);
        return { audioUrl };
      }),

    export: protectedProcedure
      .input(z.object({ personaId: z.number() }))
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
          intimacy,
        });
        return { html, fileName: `${data.persona.name}-对话记录.html` };
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
              label: adapter.label,
              requiresCredentials: adapter.requiresCredentials,
              connected: status.connected,
              status: status.status,
            };
          } catch {
            return {
              id: adapter.id,
              label: adapter.label,
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
        await adapter.start(ctx.user.id);
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
          throw new TRPCError({ code: "BAD_REQUEST", message: "该通道不需要这样配置凭据" });
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
          throw new TRPCError({ code: "BAD_REQUEST", message: "这个分身还没有完成解析" });
        }

        const templateId = `${input.name.trim().replace(/\s+/g, "-").toLowerCase()}-${Date.now().toString(36)}`;
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
          throw new TRPCError({ code: "BAD_REQUEST", message: "文件不是有效的 JSON" });
        }

        const validation = validateTemplate(parsed);
        if (!validation.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: validation.error });
        }

        const template = normalizeTemplate(parsed);
        const templateId = `${template.id}-${Date.now().toString(36)}`;
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
          analysisMessage: "从模板创建",
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
          throw new TRPCError({ code: "BAD_REQUEST", message: "这个分身还没有完成解析" });
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
        });

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
            message: `无法读取角色卡：${(e as Error).message}`,
          });
        }

        const imported = cardToPersonaImport(card);
        const personaData = cardToNormalizedPersona(card);

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
          analysisMessage: "从角色卡导入",
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
    listSources: protectedProcedure.query(() =>
      COLLECTOR_SOURCES.map((source) => ({
        id: source.id,
        label: source.label,
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
      .mutation(async ({ ctx, input }) => {
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
          throw new TRPCError({ code: "NOT_FOUND", message: "未知的采集来源" });
        }

        const collectInput = { target: input.target } as any;

        if (input.credentials && connector.importCredentials) {
          connector.importCredentials(input.credentials as any);
        }

        let authState: any = null;
        try {
          authState = await connector.checkAuth(collectInput);
        } catch (e) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `授权失败：${(e as Error).message}`,
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
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        startPersonaDistillation({
          personaId: input.personaId,
          userId: ctx.user.id,
          name: persona.name,
          characterFamily: input.characterFamily,
          researchProfile: input.researchProfile ?? null,
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
            message: "技能包尚未生成，无法导出",
          });
        }

        try {
          return await exportSkillToHost({
            skillPath: job.generatedSkillPath,
            host: input.host,
          });
        } catch (e) {
          console.error("[SkillEngine] Skill export failed:", e);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e instanceof Error ? e.message : "技能导出失败",
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
        extraConfig: z.record(z.string(), z.any()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        assertKnownProvider(input.providerName);
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
        assertKnownProvider(input.providerName);
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
        if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "请先配置默认 LLM 提供商" });
        const merged = { ...((config.extraConfig as any) || {}), ...input.extraConfig };
        await upsertLlmConfig(ctx.user.id, { providerName: config.providerName, extraConfig: merged });
        invalidateUserProviderCache(ctx.user.id);
        return { success: true };
      }),

    setDefault: protectedProcedure
      .input(z.object({ providerName: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        assertKnownProvider(input.providerName);
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
        return getMemoriesByPersonaId(input.personaId, ctx.user.id);
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
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const id = await createMemory({ ...input, userId: ctx.user.id });
        return { id };
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
        if (history.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "没有聊天记录可供提取" });

        const chatText = history.map(m => `${m.role === "user" ? "用户" : persona.name}: ${m.content}`).join("\n");
        const response = await llmService.invoke({
          messages: [
            { role: "system", content: "你是记忆提取助手。请从对话中提取重要的记忆节点。只返回JSON数组，每个元素包含 title, description, category(milestone/memory/anniversary/anchor), date(如果能推断)。最多提取5条。\n\ncategory 的含义：\n- milestone：重要时刻（第一次见面、分手那天）\n- memory：普通回忆\n- anniversary：每年重复的纪念日\n- anchor：具体的事实型记忆（例如「TA 的生日是 3 月 14 日」「TA 在 XX 大学读书」）。这类记忆是对话中不可违背的事实，如果对话里出现了明确的具体日期、地点、称呼、身份信息，就标记为 anchor。" },
            { role: "user", content: chatText },
          ],
        });

        const extracted: Array<{ title: string; description?: string; category?: string; date?: string }> = [];
        try {
          const arr = extractJsonArray(response);
          if (arr) {
            for (const raw of arr.slice(0, 5)) {
              const item = (raw ?? {}) as {
                title?: string;
                description?: string;
                category?: string;
                date?: string;
              };
              const id = await createMemory({
                personaId: input.personaId, userId: ctx.user.id,
                title: item.title || "记忆",
                description: item.description,
                category: (["milestone", "memory", "anniversary", "anchor"].includes(item.category as string) ? item.category : "memory") as any,
                date: item.date,
              });
              extracted.push({ ...item, title: item.title || "记忆" });
            }
          }
        } catch (e) { console.error("[autoExtract] parse error:", e); }

        return { extracted };
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
        const date = input.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "日期格式无效，需要 YYYY-MM-DD" });
        }
        const today = new Date().toISOString().slice(0, 10);
        if (date > today) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不能为未来日期生成日记" });
        }
        const existing = await getDiaryByDate(input.personaId, ctx.user.id, date);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "该日期已有日记" });
        const msgs = await getMessagesByDate(input.personaId, ctx.user.id, date);
        if (msgs.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "该日期没有聊天记录" });
        const chatText = msgs.map(m => `${m.role === "user" ? "用户" : persona.name}: ${m.content || ""}`).join("\n");
        if (!chatText.trim()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "该日期的聊天记录内容为空" });
        }
        const response = await llmService.invoke({
          messages: [
            { role: "system", content: '你是日记助手。请根据对话记录生成一篇温暖的日记。只返回JSON：{"summary":"2-3句概述","highlights":["亮点1","亮点2"],"emotionalArc":{"start":"开始情绪","end":"结束情绪","dominant":"主导情绪"},"quotes":["原话1","原话2"],"reflection":"温暖的反思1-2句"}' },
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
          summary: parsed.summary || "今天和TA聊了天",
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

  scene: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getScenes(ctx.user.id);
    }),

    create: protectedProcedure
      .input(z.object({ name: z.string().min(1).max(100), description: z.string().optional(), icon: z.string().max(10).optional(), systemPromptOverlay: z.string().optional(), emotionalState: z.string().optional(), starters: z.array(z.string()).optional() }))
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
          throw new TRPCError({ code: "FORBIDDEN", message: "这个场景不存在，或者不属于你" });
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
        const [stats, messageVolume, emotionTimeline, personaEngagement, hourlyDistribution] = await Promise.all([
          getAnalyticsStats(ctx.user.id, input.days),
          getMessageVolume(ctx.user.id, input.days),
          getEmotionTimeline(ctx.user.id, input.days),
          getPersonaEngagement(ctx.user.id, input.days),
          getHourlyDistribution(ctx.user.id, input.days),
        ]);
        return { stats, messageVolume, emotionTimeline, personaEngagement, hourlyDistribution };
      }),
  }),
});

export type AppRouter = typeof appRouter;
