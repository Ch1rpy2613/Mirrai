import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { llmService } from "./index";

/**
 * A voice note is heard, or it is not.
 *
 * The app used to *pretend* to transcribe: it asked the chat model to
 * guess what the recording might have said from how many seconds it
 * lasted — and the prompt told the model to guess. So the guess was
 * shown to the user as their own words, it was stored as their own
 * words, and the persona answered it warmly.
 *
 * A model told to guess does not answer "I could not hear that". The
 * fabrication was the normal case, not the exception.
 */
describe("the speech-to-text service", () => {
  it("says so when the provider cannot hear", async () => {
    // Most providers cannot: the speech-to-text is a separate service.
    // A provider that cannot has to say so — the caller tells the user
    // their voice note could not be understood, rather than making
    // something up.
    const provider = {
      name: "ollama",
      capabilities: { streaming: true, vision: false, tools: false, jsonMode: false },
      isConfigured: () => true,
      invoke: async () => "在的。",
    };
    await expect(
      llmService.transcribeWithProvider(provider as any, Buffer.from("audio"), "voice.webm"),
    ).rejects.toThrow(/cannot hear a recording/);
  });

  it("sends the recording to a provider that can", async () => {
    const provider = {
      name: "openai",
      capabilities: { streaming: true, vision: true, tools: true, jsonMode: true },
      isConfigured: () => true,
      invoke: async () => "在的。",
      transcribe: async () => "我今天有点累。",
    };
    const text = await llmService.transcribeWithProvider(
      provider as any,
      Buffer.from("audio"),
      "voice.webm",
    );
    expect(text).toBe("我今天有点累。");
  });

  it("refuses a provider that is not configured", async () => {
    const provider = {
      name: "openai",
      capabilities: { streaming: true, vision: true, tools: true, jsonMode: true },
      isConfigured: () => false,
      invoke: async () => "在的。",
    };
    await expect(
      llmService.transcribeWithProvider(provider as any, Buffer.from("audio"), "voice.webm"),
    ).rejects.toThrow(/not configured/);
  });

  it("is never a guess", () => {
    // The prompt that asked for a guess is gone. The recording now goes
    // to the provider's speech-to-text service, and a provider that
    // cannot hear says so.
    const source = readFileSync(
      path.resolve(__dirname, "..", "..", "shared", "copy", "prompts.ts"),
      "utf-8",
    );
    expect(source).not.toContain("voiceTranscription");
    expect(source).not.toContain("猜测可能的内容");
  });
});
