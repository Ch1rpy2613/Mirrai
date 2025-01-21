import { WechatyBuilder, ScanStatus } from "wechaty";
import type { WechatyInterface } from "wechaty/impls";
import { handleWeChatMessage } from "./message-handler";

let bot: WechatyInterface | null = null;
let currentQrUrl: string | null = null;
let botStatus: "stopped" | "scanning" | "logged_in" | "error" = "stopped";
let loggedInUser: string | null = null;

export function getBotStatus() {
  return { status: botStatus, qrCodeUrl: currentQrUrl, loggedInUser };
}

export function startWeChatBot() {
  if (bot) return;

  const CHROME_BIN = process.env.CHROME_BIN ? { endpoint: process.env.CHROME_BIN } : {};

  bot = WechatyBuilder.build({
    name: "Girlfriend",
    puppet: "wechaty-puppet-wechat4u",
    puppetOptions: { uos: true, ...CHROME_BIN },
  });

  bot.on("scan", (qrcode: string, status: number) => {
    if (status === ScanStatus.Waiting || status === ScanStatus.Timeout) {
      currentQrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrcode)}`;
      botStatus = "scanning";
      console.log("[WeChat] Scan QR:", currentQrUrl);
    }
  });

  bot.on("login", (user: any) => {
    loggedInUser = user.name();
    botStatus = "logged_in";
    currentQrUrl = null;
    console.log(`[WeChat] ${loggedInUser} logged in`);
  });

  bot.on("logout", (user: any) => {
    loggedInUser = null;
    botStatus = "stopped";
    console.log(`[WeChat] ${user.name()} logged out`);
  });

  bot.on("message", async (msg: any) => {
    try {
      await handleWeChatMessage(msg, bot!);
    } catch (e) {
      console.error("[WeChat] Message handler error:", e);
    }
  });

  bot.on("error", (e: Error) => {
    console.error("[WeChat] Bot error:", e);
    botStatus = "error";
  });

  bot.start()
    .then(() => console.log("[WeChat] Bot starting, waiting for scan..."))
    .catch((e: Error) => {
      console.error("[WeChat] Bot start failed:", e);
      botStatus = "error";
    });
}

export async function stopWeChatBot() {
  if (!bot) return;
  try {
    await bot.stop();
  } catch (e) {
    console.error("[WeChat] Bot stop error:", e);
  }
  bot = null;
  botStatus = "stopped";
  currentQrUrl = null;
  loggedInUser = null;
}
