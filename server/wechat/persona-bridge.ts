import { llmService } from "../llm";
import * as db from "../db";
import { getEmotionalStateDesc, buildSystemPrompt } from "../_core/persona-utils";
import { inferEmotionalState } from "../_core/emotion";

/**
 * Handles one inbound WeChat message against a persona.
 *
 * The persona id is resolved by the caller (default binding, or a
 * session-scoped override chosen with `/使用`).
 */
export async function handlePersonaChat(params: {
  userId: number;
  wechatUserId: string;
  personaId: number;
  messageText: string;
}): Promise<string | null> {
  const { userId, personaId, messageText } = params;

  const persona = await db.getPersonaById(personaId, userId);
  if (!persona || persona.analysisStatus !== "ready") return null;

  await db.createMessage({
    personaId,
    userId,
    role: "user",
    content: messageText,
    emotionalState: persona.emotionalState,
    channel: "wechat",
  });

  const history = await db.getMessagesByPersonaId(personaId, 20);
  const systemPrompt = buildSystemPrompt(persona);

  const provider = (persona as any).llmProvider || undefined;
  const replyText = await llmService.invoke({
    messages: [
      { role: "system", content: systemPrompt },
      ...history.slice(-19).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ],
    options: { provider },
  }) || "（沉默）";

  const emotion = await inferEmotionalState({
    userMessage: messageText,
    assistantReply: replyText,
    currentState: persona.emotionalState,
    provider,
  });
  const newState = emotion.state;

  await db.createMessage({
    personaId,
    userId,
    role: "assistant",
    content: replyText,
    emotionalState: newState,
    channel: "wechat",
  });

  await db.updatePersona(personaId, userId, {
    chatCount: (persona.chatCount || 0) + 1,
    lastChatAt: new Date(),
    emotionalState: newState as any,
  });

  return replyText;
}
