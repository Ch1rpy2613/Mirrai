import { llmService } from "../llm";
import * as db from "../db";
import { getEmotionalStateDesc, buildSystemPrompt } from "../_core/persona-utils";
import { inferEmotionalState } from "../_core/emotion";

export async function handlePersonaChat(
  contactId: string,
  contactName: string,
  messageText: string,
): Promise<string | null> {
  const binding = await db.getWechatBindingByContactId(contactId);
  if (!binding) return null;

  const persona = await db.getPersonaById(binding.personaId, binding.userId);
  if (!persona || persona.analysisStatus !== "ready") return null;

  await db.createMessage({
    personaId: binding.personaId,
    userId: binding.userId,
    role: "user",
    content: messageText,
    emotionalState: persona.emotionalState,
    channel: "wechat",
  });

  const history = await db.getMessagesByPersonaId(binding.personaId, 20);
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
    personaId: binding.personaId,
    userId: binding.userId,
    role: "assistant",
    content: replyText,
    emotionalState: newState,
    channel: "wechat",
  });

  await db.updatePersona(binding.personaId, binding.userId, {
    chatCount: (persona.chatCount || 0) + 1,
    lastChatAt: new Date(),
    emotionalState: newState as any,
  });

  return replyText;
}
