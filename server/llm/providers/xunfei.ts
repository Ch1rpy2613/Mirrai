import type { LLMMessage, LLMOptions, LLMProvider } from "../types";
import { getTextContent } from "../types";
import WebSocket from "ws";
import { createHmac } from "crypto";

export class XunfeiProvider implements LLMProvider {
  name = "xunfei";

  constructor(
    private appId: string,
    private apiKey: string,
    private apiSecret: string,
    private modelVersion: string,
  ) {}

  isConfigured(): boolean {
    return !!this.appId && !!this.apiKey && !!this.apiSecret;
  }

  private getModelDomain(): string {
    const map: Record<string, string> = {
      "v1.1": "general", "v2.1": "generalv2", "v3.1": "generalv3",
      "v3.5": "generalv3.5", "pro-128k": "pro-128k",
      "max-32k": "max-32k", "v4.0": "4.0Ultra",
    };
    return map[this.modelVersion] || "4.0Ultra";
  }

  private generateWsUrl(): string {
    const host = "spark-api.xf-yun.com";
    const path = `/${this.modelVersion}/chat`;
    const date = new Date().toUTCString();
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    const signature = createHmac("sha256", this.apiSecret).update(signatureOrigin).digest("base64");
    const authOrigin = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
    const authorization = Buffer.from(authOrigin).toString("base64");
    return `wss://${host}${path}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;
  }

  async invoke(messages: LLMMessage[], _options?: LLMOptions): Promise<string> {
    const wsUrl = this.generateWsUrl();
    const domain = this.getModelDomain();

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      let result = "";

      socket.on("open", () => {
        socket.send(JSON.stringify({
          header: { app_id: this.appId, uid: "girlfriend" },
          parameter: { chat: { domain, temperature: 0.8, max_tokens: 2048 } },
          payload: {
            message: {
              text: messages.map(m => ({ role: m.role, content: getTextContent(m.content) })),
            },
          },
        }));
      });

      socket.on("message", (raw) => {
        const data = JSON.parse(raw.toString());
        if (data.header.code !== 0) {
          socket.close();
          reject(new Error(`[Xunfei] code ${data.header.code}: ${data.header.message}`));
          return;
        }
        const text = data.payload?.choices?.text?.[0]?.content ?? "";
        result += text;
        if (data.header.status === 2) {
          setTimeout(() => socket.close(), 200);
        }
      });

      socket.on("close", () => resolve(result));
      socket.on("error", (e) => reject(new Error(`[Xunfei] ws error: ${e.message}`)));
    });
  }
}
