/**
 * Slash commands for the WeChat channel.
 *
 * Commands are intercepted before the message reaches the LLM, so they cost no
 * model calls. The active persona chosen with `/使用` lives in the session
 * (process memory) rather than the database: it is a temporary override that
 * falls back to the account's default persona after a restart.
 */
import { checkGraduationEligibility } from "../_core/persona-utils";
import { getMessageCountInRange, getPersonasByUserId, getRecentEmotionTrend, setGraduationStatus } from "../db";
import { llmService } from "../llm";
import type { Persona } from "../../drizzle/schema";

/** Session-scoped persona override, keyed by WeChat conversation id. */
const activePersonaOverrides = new Map<string, number>();

/** Returns the persona id currently in effect for a conversation. */
export function getActivePersonaId(wechatUserId: string, defaultPersonaId: number): number {
  return activePersonaOverrides.get(wechatUserId) ?? defaultPersonaId;
}

/** Clears any session-scoped override for a conversation. */
export function clearActivePersona(wechatUserId: string): void {
  activePersonaOverrides.delete(wechatUserId);
}

/** Clears every session-scoped override (used on account disconnect). */
export function clearAllActivePersonas(): void {
  activePersonaOverrides.clear();
}
export type CommandResult = {
  /** True when the command was recognised and handled. */
  handled: boolean;
  /** Reply text to send back to the user. */
  reply?: string;
};

const COMMAND_HELP = [
  "可用指令：",
  "/使用 <分身名> — 切换当前对话的分身",
  "/分身列表 — 查看所有可用分身",
  "/当前分身 — 查看当前正在对话的分身",
  "/毕业 — 生成告别信并完成毕业",
].join("\n");

/**
 * Resolves a persona by name.
 *
 * Matching is tried in order: exact name, unique substring, unique prefix.
 * Ambiguity is reported rather than guessed.
 */
export function matchPersonaByName(
  personas: Array<Pick<Persona, "id" | "name">>,
  query: string,
): { kind: "exact" | "contains" | "prefix"; persona?: Persona; candidates?: string[] } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { kind: "exact" };

  const exact = personas.find((p) => p.name.toLowerCase() === needle);
  if (exact) return { kind: "exact", persona: exact as Persona };

  const contains = personas.filter((p) => p.name.toLowerCase().includes(needle));
  if (contains.length === 1) return { kind: "contains", persona: contains[0] as Persona };
  if (contains.length > 1) {
    return { kind: "contains", candidates: contains.map((p) => p.name) };
  }

  const prefixed = personas.filter((p) => p.name.toLowerCase().startsWith(needle));
  if (prefixed.length === 1) return { kind: "prefix", persona: prefixed[0] as Persona };
  if (prefixed.length > 1) {
    return { kind: "prefix", candidates: prefixed.map((p) => p.name) };
  }

  return { kind: "exact" };
}

/** Parses a command line into its command name and arguments. */
export function parseCommandLine(text: string): { command: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const spaceIdx = trimmed.indexOf(" ");
  const command = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  return { command, args };
}

/**
 * Handles a slash command.
 *
 * `defaultPersonaId` is the account's bound default persona; the session
 * override takes precedence when present.
 */
export async function handleCommand(params: {
  userId: number;
  wechatUserId: string;
  text: string;
  defaultPersonaId: number;
  /** Sends the graduation letter to the user; resolves false on failure. */
  sendLetter?: (letter: string) => Promise<boolean>;
}): Promise<CommandResult> {
  const parsed = parseCommandLine(params.text);
  if (!parsed) return { handled: false };

  const { command, args } = parsed;

  switch (command) {
    case "/使用":
    case "/use": {
      if (!args) {
        return { handled: true, reply: "用法：/使用 <分身名>。\n" + COMMAND_HELP };
      }

      const all = await getPersonasByUserId(params.userId);
      const ready = all.filter((p) => p.analysisStatus === "ready");
      if (ready.length === 0) {
        return { handled: true, reply: "还没有可以对话的分身，请先在网页端完成解析。" };
      }

      const match = matchPersonaByName(ready, args);
      if (!match.persona) {
        if (match.candidates && match.candidates.length > 0) {
          return {
            handled: true,
            reply: `有多个分身匹配「${args}」：${match.candidates.join("、")}。请说得更具体一些。`,
          };
        }
        return {
          handled: true,
          reply: `没有找到分身「${args}」。可用分身：${ready.map((p) => p.name).join("、")}`,
        };
      }

      activePersonaOverrides.set(params.wechatUserId, match.persona.id);
      return { handled: true, reply: `已切换到 ${match.persona.name}。` };
    }

    case "/分身列表":
    case "/personas": {
      const all = await getPersonasByUserId(params.userId);
      if (all.length === 0) {
        return { handled: true, reply: "你还没有创建任何分身。" };
      }
      const activeId = getActivePersonaId(params.wechatUserId, params.defaultPersonaId);
      const lines = all.map((p) => {
        const marker = p.id === activeId ? " ← 当前" : "";
        const ready = p.analysisStatus === "ready" ? "" : "（解析中）";
        return `- ${p.name}${ready}${marker}`;
      });
      return { handled: true, reply: ["你的分身：", ...lines].join("\n") };
    }

    case "/当前分身":
    case "/current": {
      const all = await getPersonasByUserId(params.userId);
      const activeId = getActivePersonaId(params.wechatUserId, params.defaultPersonaId);
      const persona = all.find((p) => p.id === activeId);
      return {
        handled: true,
        reply: persona ? `当前正在和 ${persona.name} 说话。` : "当前没有绑定分身。",
      };
    }

    case "/毕业":
    case "/graduate":
      return await handleGraduationCommand(params);

    case "/帮助":
    case "/help":
      return { handled: true, reply: COMMAND_HELP };

    default:
      // Unknown commands fall through to the normal conversation.
      return { handled: false };
  }
}

/**
 * Generates the farewell letter and completes the graduation.
 *
 * The letter is delivered over WeChat when possible; if delivery fails the
 * user is told to read it on the web, where it is always persisted.
 */
async function handleGraduationCommand(params: {
  userId: number;
  wechatUserId: string;
  defaultPersonaId: number;
  sendLetter?: (letter: string) => Promise<boolean>;
}): Promise<CommandResult> {
  const personaId = getActivePersonaId(params.wechatUserId, params.defaultPersonaId);
  const all = await getPersonasByUserId(params.userId);
  const persona = all.find((p) => p.id === personaId);
  if (!persona) {
    return { handled: true, reply: "当前没有绑定分身。" };
  }
  if (persona.analysisStatus !== "ready") {
    return { handled: true, reply: `${persona.name} 还在解析中，暂时不能毕业。` };
  }
  if (persona.graduationStatus === "graduated") {
    return {
      handled: true,
      reply: persona.farewellLetter
        ? `${persona.name} 已经毕业了。\n\n${persona.farewellLetter}`
        : `${persona.name} 已经毕业了。`,
    };
  }
  if (persona.graduationStatus === "declined") {
    return { handled: true, reply: `${persona.name} 的毕业已被推迟。想清楚再回来。` };
  }

  // Re-check eligibility before honouring the request.
  const recentEmotions = await getRecentEmotionTrend(personaId, 14);
  const recentFreq = await getMessageCountInRange(personaId, 7, 0);
  const prevFreq = await getMessageCountInRange(personaId, 14, 7);
  const eligibility = checkGraduationEligibility({
    intimacyLevel: persona.intimacyLevel,
    recentEmotions,
    chatCount: persona.chatCount || 0,
    recentChatFrequency: recentFreq,
    previousChatFrequency: prevFreq,
  });

  if (!eligibility.eligible && persona.graduationStatus !== "suggested") {
    return {
      handled: true,
      reply: `现在还不是告别的时候：${eligibility.reason}。\n再陪 TA 走一段吧。`,
    };
  }

  const response = await llmService.invoke({
    messages: [
      { role: "system", content: "你是一个正在道别的角色，语气要克制、温柔、不说教。" },
      {
        role: "user",
        content: `我们已经走过了很长的路，现在是时候说再见了。请用${persona.name}的口吻，写一封温暖的告别信。回顾我们的美好时光，表达祝福和不舍。信的长度在200-400字之间。只返回信的内容，不要有其他文字。`,
      },
    ],
  });

  const farewellLetter =
    response || `亲爱的，感谢你一路的陪伴。虽然我们要说再见了，但那些美好的回忆会永远留在心里。祝你一切都好。—— ${persona.name}`;

  await setGraduationStatus(personaId, params.userId, "graduated", farewellLetter);

  let delivered = false;
  if (params.sendLetter) {
    try {
      delivered = await params.sendLetter(farewellLetter);
    } catch (e) {
      console.error("[WeChat] Failed to deliver farewell letter:", e);
    }
  }

  if (delivered) {
    return { handled: true, reply: farewellLetter };
  }

  return {
    handled: true,
    reply: `${farewellLetter}\n\n（这封信已经保存了，如果微信没有显示，请在网页端查看。）`,
  };
}
