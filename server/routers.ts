import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { llmService, registry } from "./llm";
import type { InvokeParams, InvokeResult } from "./llm/types";
import { getTextContent } from "./llm/types";
import { storagePut } from "./storage";
import {
  createPersona, getPersonasByUserId, getPersonaById, updatePersona, deletePersona,
  getPersonasWithStats, getUserStats, getRecentActivity, getDailyChatCounts,
  createPersonaFile, getFilesByPersonaId,
  createMessage, getMessagesByPersonaId, clearMessagesByPersonaId, searchMessages,
  createWechatBinding, getWechatBindingsByUserId, deleteWechatBinding, setWechatBindingPersona,
  getSkillJobById, getLlmConfigsByUserId, upsertLlmConfig, setDefaultLlmConfig, getDefaultLlmConfig,
  updateUserProfile, updateUserPassword, deleteUserAccount, getAccountStats, exportUserData,
  getUserById,
  createMemory, getMemoriesByPersonaId, deleteMemory,
  createEmotionSnapshot, getEmotionSnapshots, getEmotionReport, getTodaySnapshot,
  getIntimacyData, updateIntimacy,
  getMessageVolume, getEmotionTimeline, getPersonaEngagement, getHourlyDistribution, getAnalyticsStats,
  createDiaryEntry, getDiaryEntries, getDiaryByDate, deleteDiaryEntry, getMessagesByDate, getDiaryDates,
  getScenes, getSceneById, createScene, deleteScene, activateScene,
  getExportData, getRecentEmotionTrend, getMessageCountInRange, setGraduationStatus,
} from "./db";
import { nanoid } from "nanoid";
import { getBotStatus, startWeChatBot, stopWeChatBot, startLogin, submitVerifyCode, cancelLogin } from "./wechat/bot";
import { clearAllActivePersonas } from "./wechat/commands";
import { runSkillPipeline } from "./skill-engine/pipeline";
import { getEmotionalStateDesc, buildSystemPrompt, computeIntimacy, checkGraduationEligibility } from "./_core/persona-utils";
import { inferEmotionalState } from "./_core/emotion";
import { hashPassword, verifyPassword } from "./_core/password";
import { extractJsonArray, extractJsonObject } from "./_core/json";

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
}): Promise<void> {
  const { personaId, userId, name, characterFamily } = params;

  try {
    const files = await getFilesByPersonaId(personaId);
    const chatContent = files
      .filter((f) => f.fileType === "chat_txt" || f.fileType === "chat_csv")
      .map((f) => f.extractedMemory || "")
      .join("\n\n---\n\n");
    const imageUrls = files
      .filter((f) => f.fileType === "image")
      .map((f) => f.fileUrl)
      .filter(Boolean);

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
      chatContent,
      imageUrls,
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

export const appRouter = router({
  system: systemRouter,

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
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
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

    create: protectedProcedure
      .input(z.object({ name: z.string().min(1).max(100), relationshipDesc: z.string().max(200).optional(), togetherFrom: z.string().max(50).optional(), togetherTo: z.string().max(50).optional() }))
      .mutation(async ({ ctx, input }) => {
        const id = await createPersona({ userId: ctx.user.id, ...input, analysisStatus: "pending" });
        return { id };
      }),

    update: protectedProcedure
      .input(z.object({ id: z.number(), name: z.string().min(1).max(100).optional(), relationshipDesc: z.string().max(200).optional(), togetherFrom: z.string().max(50).optional(), togetherTo: z.string().max(50).optional(), emotionalState: z.enum(["warm","playful","nostalgic","melancholy","happy","distant"]).optional(), llmProvider: z.string().max(64).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
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
        await deletePersona(input.id, ctx.user.id);
        return { success: true };
      }),

    getIntimacy: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const data = await getIntimacyData(input.id, ctx.user.id);
        const result = computeIntimacy(data);
        await updateIntimacy(input.id, ctx.user.id, result.score, result.level);
        const nextLevel = [
          { threshold: 0, name: "初识" }, { threshold: 100, name: "熟悉" },
          { threshold: 300, name: "亲密" }, { threshold: 600, name: "知己" },
          { threshold: 1000, name: "灵魂伴侣" },
        ];
        const currentIdx = nextLevel.findIndex(l => l.name === result.level);
        const next = nextLevel[currentIdx + 1];
        return { ...result, breakdown: data, nextLevel: next?.name || null, nextThreshold: next?.threshold || 1000 };
      }),

    getAnalysisStatus: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return { status: persona.analysisStatus, progress: persona.analysisProgress, message: persona.analysisMessage };
      }),

    triggerAnalysis: protectedProcedure
      .input(z.object({ id: z.number(), characterFamily: z.enum(["colleague", "relationship", "celebrity"]).default("relationship") }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.id, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        startPersonaDistillation({
          personaId: input.id,
          userId: ctx.user.id,
          name: persona.name,
          characterFamily: input.characterFamily,
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
        const recentEmotions = await getRecentEmotionTrend(input.id, 14);
        const recentFreq = await getMessageCountInRange(input.id, 7, 0);
        const prevFreq = await getMessageCountInRange(input.id, 14, 7);
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
    upload: protectedProcedure
      .input(z.object({ personaId: z.number(), fileName: z.string(), fileType: z.enum(["chat_txt","chat_csv","image","video"]), fileSize: z.number(), fileContent: z.string(), mimeType: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const buffer = Buffer.from(input.fileContent, "base64");
        const fileKey = `personas/${ctx.user.id}/${input.personaId}/${nanoid()}-${input.fileName}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);
        let extractedText: string | undefined;
        if (input.fileType === "chat_txt" || input.fileType === "chat_csv") {
          extractedText = buffer.toString("utf-8").slice(0, 50000);
        }
        const fileId = await createPersonaFile({ personaId: input.personaId, userId: ctx.user.id, fileType: input.fileType, originalName: input.fileName, fileKey, fileUrl: url, fileSize: input.fileSize, extractedMemory: extractedText?.slice(0, 2000), processStatus: "done" });
        return { fileId, fileUrl: url };
      }),

    list: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getFilesByPersonaId(input.personaId);
      }),
  }),

  chat: router({
    getHistory: protectedProcedure
      .input(z.object({ personaId: z.number(), limit: z.number().default(50) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getMessagesByPersonaId(input.personaId, input.limit);
      }),

    send: protectedProcedure
      .input(z.object({ personaId: z.number(), message: z.string().min(1).max(2000) }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "分身还未准备好，请先完成 AI 解析" });

        const scene = persona.activeSceneId ? await getSceneById(persona.activeSceneId) : null;
        await createMessage({ personaId: input.personaId, userId: ctx.user.id, role: "user", content: input.message, emotionalState: persona.emotionalState });

        const defaultConfig = await getDefaultLlmConfig(ctx.user.id);
        const extra = (defaultConfig?.extraConfig as any) || {};
        const contextLimit = extra.contextLimit || 20;
        const history = await getMessagesByPersonaId(input.personaId, contextLimit);
        const systemPrompt = buildSystemPrompt(persona, scene?.systemPromptOverlay);
        const llmMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: systemPrompt },
          ...history.slice(-(contextLimit - 1)).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        ];

        const provider = (persona as any).llmProvider || undefined;
        const response = await llmService.invoke({
          messages: llmMessages,
          options: { provider, temperature: extra.temperature, maxTokens: extra.maxTokens },
        });
        const replyText = response || "（沉默）";
        const emotion = await inferEmotionalState({
          userMessage: input.message,
          assistantReply: replyText,
          currentState: persona.emotionalState,
          provider,
        });
        const newEmotionalState = emotion.state;

        await createMessage({ personaId: input.personaId, userId: ctx.user.id, role: "assistant", content: replyText, emotionalState: newEmotionalState });
        await updatePersona(input.personaId, ctx.user.id, { chatCount: (persona.chatCount || 0) + 1, lastChatAt: new Date(), emotionalState: newEmotionalState as any });

        const todayStr = new Date().toISOString().slice(0, 10);
        const existing = await getTodaySnapshot(input.personaId, ctx.user.id);
        if (!existing) {
          await createEmotionSnapshot({ personaId: input.personaId, userId: ctx.user.id, emotionalState: newEmotionalState, messageCount: 1, date: todayStr });
        }

        const intimacyData = await getIntimacyData(input.personaId, ctx.user.id);
        const intimacy = computeIntimacy(intimacyData);
        await updateIntimacy(input.personaId, ctx.user.id, intimacy.score, intimacy.level);

        let graduationSuggested = false;
        if (intimacy.level === "灵魂伴侣" && !persona.graduationStatus) {
          const recentEmotions = await getRecentEmotionTrend(input.personaId, 14);
          const recentFreq = await getMessageCountInRange(input.personaId, 7, 0);
          const prevFreq = await getMessageCountInRange(input.personaId, 14, 7);
          const gradResult = checkGraduationEligibility({
            intimacyLevel: intimacy.level,
            recentEmotions,
            chatCount: (persona.chatCount || 0) + 1,
            recentChatFrequency: recentFreq,
            previousChatFrequency: prevFreq,
          });
          if (gradResult.eligible) {
            await setGraduationStatus(input.personaId, ctx.user.id, "suggested");
            graduationSuggested = true;
          }
        }

        return { reply: replyText, emotionalState: newEmotionalState, graduationSuggested };
      }),

    sendImage: protectedProcedure
      .input(z.object({ personaId: z.number(), imageContent: z.string(), fileName: z.string(), mimeType: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "分身还未准备好" });

        const scene = persona.activeSceneId ? await getSceneById(persona.activeSceneId) : null;
        const buffer = Buffer.from(input.imageContent, "base64");
        const fileKey = `chat/${ctx.user.id}/${input.personaId}/${nanoid()}-${input.fileName}`;
        const { url } = await storagePut(fileKey, buffer, input.mimeType);

        await createMessage({ personaId: input.personaId, userId: ctx.user.id, role: "user", content: "[图片]", messageType: "image", mediaUrl: url, emotionalState: persona.emotionalState });

        const defaultConfig = await getDefaultLlmConfig(ctx.user.id);
        const extra = (defaultConfig?.extraConfig as any) || {};
        const contextLimit = extra.contextLimit || 20;
        const history = await getMessagesByPersonaId(input.personaId, contextLimit);
        const systemPrompt = buildSystemPrompt(persona, scene?.systemPromptOverlay);

        const llmMessages = [
          { role: "system" as const, content: systemPrompt },
          ...history.slice(-(contextLimit - 1)).map((m) => {
            if (m.messageType === "image" && m.mediaUrl) {
              return { role: m.role as "user" | "assistant", content: [{ type: "text" as const, text: m.content }, { type: "image_url" as const, url: m.mediaUrl }] };
            }
            return { role: m.role as "user" | "assistant", content: m.content };
          }),
        ];

        const provider = (persona as any).llmProvider || undefined;
        const response = await llmService.invoke({ messages: llmMessages, options: { provider, temperature: extra.temperature, maxTokens: extra.maxTokens } });
        const replyText = response || "（沉默）";
        const emotion = await inferEmotionalState({
          userMessage: "[图片]",
          assistantReply: replyText,
          currentState: persona.emotionalState,
          provider,
        });
        const newEmotionalState = emotion.state;

        await createMessage({ personaId: input.personaId, userId: ctx.user.id, role: "assistant", content: replyText, emotionalState: newEmotionalState });
        await updatePersona(input.personaId, ctx.user.id, { chatCount: (persona.chatCount || 0) + 1, lastChatAt: new Date(), emotionalState: newEmotionalState as any });

        return { reply: replyText, emotionalState: newEmotionalState, imageUrl: url };
      }),

    sendVoice: protectedProcedure
      .input(z.object({ personaId: z.number(), audioContent: z.string(), duration: z.number(), fileName: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        if (persona.analysisStatus !== "ready") throw new TRPCError({ code: "BAD_REQUEST", message: "分身还未准备好" });

        const scene = persona.activeSceneId ? await getSceneById(persona.activeSceneId) : null;
        const buffer = Buffer.from(input.audioContent, "base64");
        const fileKey = `chat/${ctx.user.id}/${input.personaId}/${nanoid()}-${input.fileName}`;
        const { url } = await storagePut(fileKey, buffer, "audio/webm");

        const transcription = await llmService.invoke({
          messages: [{ role: "user", content: `请将以下语音消息转写为文字。如果无法转写，请根据上下文猜测可能的内容。语音时长：${input.duration}秒` }],
        }) || "（语音消息）";

        await createMessage({ personaId: input.personaId, userId: ctx.user.id, role: "user", content: transcription, messageType: "voice", mediaUrl: url, mediaDuration: input.duration, emotionalState: persona.emotionalState });

        const defaultConfig = await getDefaultLlmConfig(ctx.user.id);
        const extra = (defaultConfig?.extraConfig as any) || {};
        const contextLimit = extra.contextLimit || 20;
        const history = await getMessagesByPersonaId(input.personaId, contextLimit);
        const systemPrompt = buildSystemPrompt(persona, scene?.systemPromptOverlay);
        const llmMessages = [
          { role: "system" as const, content: systemPrompt },
          ...history.slice(-(contextLimit - 1)).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        ];

        const provider = (persona as any).llmProvider || undefined;
        const response = await llmService.invoke({ messages: llmMessages, options: { provider, temperature: extra.temperature, maxTokens: extra.maxTokens } });
        const replyText = response || "（沉默）";
        const emotion = await inferEmotionalState({
          userMessage: transcription,
          assistantReply: replyText,
          currentState: persona.emotionalState,
          provider,
        });
        const newEmotionalState = emotion.state;

        await createMessage({ personaId: input.personaId, userId: ctx.user.id, role: "assistant", content: replyText, emotionalState: newEmotionalState });
        await updatePersona(input.personaId, ctx.user.id, { chatCount: (persona.chatCount || 0) + 1, lastChatAt: new Date(), emotionalState: newEmotionalState as any });

        return { reply: replyText, emotionalState: newEmotionalState, transcription, voiceUrl: url };
      }),

    clear: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await clearMessagesByPersonaId(input.personaId, ctx.user.id);
        return { success: true };
      }),

    search: protectedProcedure
      .input(z.object({ personaId: z.number(), query: z.string().min(1).max(200), limit: z.number().default(50) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return searchMessages(input.personaId, ctx.user.id, input.query, input.limit);
      }),

    tts: protectedProcedure
      .input(z.object({ text: z.string().min(1).max(500), voice: z.string().max(64).optional() }))
      .mutation(async ({ input }) => {
        const { generateTTS } = await import("./_core/tts");
        const audioUrl = await generateTTS(input.text, input.voice);
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

  skillEngine: router({
    startPipeline: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        characterFamily: z.enum(["colleague", "relationship", "celebrity"]).default("relationship"),
      }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });

        startPersonaDistillation({
          personaId: input.personaId,
          userId: ctx.user.id,
          name: persona.name,
          characterFamily: input.characterFamily,
        }).catch((e) => console.error("[SkillEngine] Pipeline error:", e));

        return { success: true };
      }),

    getJobStatus: protectedProcedure
      .input(z.object({ jobId: z.number() }))
      .query(async ({ input }) => {
        const job = await getSkillJobById(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND" });
        return job;
      }),
  }),

  llmConfig: router({
    list: protectedProcedure.query(async ({ ctx }) =>
      getLlmConfigsByUserId(ctx.user.id)
    ),

    getDefault: protectedProcedure.query(async ({ ctx }) =>
      getDefaultLlmConfig(ctx.user.id)
    ),

    listProviders: protectedProcedure.query(() => registry.list()),

    upsert: protectedProcedure
      .input(z.object({
        providerName: z.string().min(1),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        model: z.string().optional(),
        extraConfig: z.record(z.string(), z.any()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await upsertLlmConfig(ctx.user.id, input);
        return { id };
      }),

    updateExtraConfig: protectedProcedure
      .input(z.object({ extraConfig: z.record(z.string(), z.any()) }))
      .mutation(async ({ ctx, input }) => {
        const config = await getDefaultLlmConfig(ctx.user.id);
        if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "请先配置默认 LLM 提供商" });
        const merged = { ...((config.extraConfig as any) || {}), ...input.extraConfig };
        await upsertLlmConfig(ctx.user.id, { providerName: config.providerName, extraConfig: merged });
        return { success: true };
      }),

    setDefault: protectedProcedure
      .input(z.object({ providerName: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await setDefaultLlmConfig(ctx.user.id, input.providerName);
        return { success: true };
      }),
  }),

  memory: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getMemoriesByPersonaId(input.personaId);
      }),

    create: protectedProcedure
      .input(z.object({
        personaId: z.number(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        category: z.enum(["milestone", "memory", "anniversary"]).default("memory"),
        date: z.string().max(50).optional(),
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

    autoExtract: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        const history = await getMessagesByPersonaId(input.personaId, 50);
        if (history.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "没有聊天记录可供提取" });

        const chatText = history.map(m => `${m.role === "user" ? "用户" : persona.name}: ${m.content}`).join("\n");
        const response = await llmService.invoke({
          messages: [
            { role: "system", content: "你是记忆提取助手。请从对话中提取重要的记忆节点。只返回JSON数组，每个元素包含 title, description, category(milestone/memory/anniversary), date(如果能推断)。最多提取5条。" },
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
                category: (["milestone", "memory", "anniversary"].includes(item.category as string) ? item.category : "memory") as any,
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
      .input(z.object({ personaId: z.number(), days: z.number().default(30) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getEmotionReport(input.personaId, input.days);
      }),

    getDailySnapshots: protectedProcedure
      .input(z.object({ personaId: z.number(), days: z.number().default(30) }))
      .query(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        return getEmotionSnapshots(input.personaId, input.days);
      }),
  }),

  diary: router({
    list: protectedProcedure
      .input(z.object({ personaId: z.number().optional(), limit: z.number().default(30) }))
      .query(async ({ ctx, input }) => getDiaryEntries(ctx.user.id, input.personaId, input.limit)),

    getByDate: protectedProcedure
      .input(z.object({ personaId: z.number(), date: z.string() }))
      .query(async ({ ctx, input }) => getDiaryByDate(input.personaId, ctx.user.id, input.date)),

    getDates: protectedProcedure
      .input(z.object({ personaId: z.number().optional() }))
      .query(async ({ ctx, input }) => getDiaryDates(ctx.user.id, input.personaId)),

    generate: protectedProcedure
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
        await deleteScene(input.id);
        return { success: true };
      }),

    activate: protectedProcedure
      .input(z.object({ personaId: z.number(), sceneId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        await activateScene(input.personaId, input.sceneId);
        return { success: true };
      }),

    deactivate: protectedProcedure
      .input(z.object({ personaId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const persona = await getPersonaById(input.personaId, ctx.user.id);
        if (!persona) throw new TRPCError({ code: "NOT_FOUND" });
        await activateScene(input.personaId, null);
        return { success: true };
      }),
  }),

  analytics: router({
    overview: protectedProcedure
      .input(z.object({ days: z.number().default(30) }))
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
