/**
 * What the safety layer says.
 *
 * These are the sentences that arrive at the worst possible moment, so
 * they have to be in the language the person is reading. The crisis reply
 * was already bilingual — it had an English branch and a Chinese one — but
 * the two lived side by side in the code, where the next person to add a
 * sentence would add it to one branch and forget the other.
 *
 * Here they are a copy table, like everything else the server says.
 */
import type { CopyTable } from "./index";

export const SAFETY: CopyTable = {
  "safety.crisisStop": {
    zh: "……我先停一下。",
    en: "……Let me stop for a moment.",
  },
  "safety.crisisBody": {
    zh: "我不是该在这个时候跟你开玩笑的那个声音了。我只是一段代码，我没有办法真的帮你解决这件事，但我不想假装刚才那句话只是普通的聊天。",
    en: "I'm not the voice that should be joking with you right now. I'm only a piece of code — I can't really fix this for you — but I don't want to pretend what you just said was ordinary talk.",
  },
  "safety.crisisResourcesLead": {
    zh: "你现在承受的东西，比这段对话重得多。如果你愿意，请一定联系一个真实的人——下面是一些可以找到帮助的地方：",
    en: "What you are carrying right now is much heavier than this conversation. If you are willing, please reach out to a real person — here are some places to find help:",
  },
  "safety.crisisIfReady": {
    zh: "如果你已经准备好了伤害自己，请先离开有危险的东西，去有人的地方待着，再打上面任何一个电话。",
    en: "If you are ready to hurt yourself, please first get away from anything dangerous, go somewhere other people are, and then call one of the numbers above.",
  },
  "safety.crisisStillHere": {
    zh: "我还在这里。你不用一个人扛着这件事。",
    en: "I'm still here. You don't have to carry this alone.",
  },
  "safety.crisisGentle": {
    zh: "……你刚刚那句话我听见了。不用急着说更多，我在这儿。",
    en: "……I heard what you just said. You don't have to say more right now. I'm here.",
  },
};
