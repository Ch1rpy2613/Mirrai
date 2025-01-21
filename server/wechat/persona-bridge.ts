import { llmService } from "../llm";
import * as db from "../db";
import { getEmotionalStateDesc, computeEmotionalState, buildSystemPrompt } from "../_core/persona-utils";

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

  const replyText = await llmService.invoke({
    messages: [
      { role: "system", content: systemPrompt },
      ...history.slice(-19).map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ],
  }) || "（沉默）";

  const newState = computeEmotionalState(messageText, replyText, persona.emotionalState);

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
