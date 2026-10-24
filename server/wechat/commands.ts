/**
 * Slash commands for the WeChat channel.
 *
 * The implementation now lives in `server/channels/commands.ts` so that every
 * channel shares it; this module stays as the WeChat-facing entry point and
 * only adapts the parameter name.
 */
import {
  handleCommand as handleChannelCommand,
  type CommandResult,
} from "../channels/commands";

export {
  clearActivePersona,
  clearAllActivePersonas,
  getActivePersonaId,
  matchPersonaByName,
  parseCommandLine,
  type CommandResult,
} from "../channels/commands";

/**
 * Handles a WeChat slash command.
 *
 * The conversation id is the counterpart id on the channel, which is what
 * the shared implementation keys its session override by.
 */
export async function handleCommand(params: {
  userId: number;
  wechatUserId: string;
  text: string;
  defaultPersonaId: number;
  sendLetter?: (letter: string) => Promise<boolean>;
}): Promise<CommandResult> {
  return handleChannelCommand({
    userId: params.userId,
    conversationKey: params.wechatUserId,
    text: params.text,
    defaultPersonaId: params.defaultPersonaId,
    // The WeChat wording of a message has to stay exactly as it was.
    channel: "wechat",
    sendLetter: params.sendLetter,
  });
}
