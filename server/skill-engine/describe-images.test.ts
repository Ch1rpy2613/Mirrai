import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The photo stage of the distillation.
 *
 * The pictures are stored as a *path* — "/uploads/personas/1/2/photo.png"
 * — with no host name in it. A provider cannot fetch that: OpenAI
 * answers "Invalid image URL" and the stage fails, and a local model
 * quietly drops the picture and answers the text anyway.
 *
 * So the model was asked "describe these photos of X and me", it had
 * never seen them, and it *invented* a description — which was then
 * stored as a memory of the persona, shown in the persona's editor and
 * fed back into the prompt. The chat path inlines its pictures; this
 * stage did not.
 */

const invokeForUserWithReason = vi.fn();
const resolveProviderForUser = vi.fn();
const storageToDataUrl = vi.fn();

vi.mock("../llm", () => ({
  llmService: { invoke: vi.fn(), invokeWithProvider: vi.fn() },
  invokeForUser: vi.fn(),
  invokeForUserWithReason: (...a: unknown[]) => invokeForUserWithReason(...a),
}));

vi.mock("../llm/user-provider", () => ({
  resolveProviderForUser: (...a: unknown[]) => resolveProviderForUser(...a),
}));

vi.mock("../storage", () => ({
  storageToDataUrl: (...a: unknown[]) => storageToDataUrl(...a),
}));

import { describeImages } from "./pipeline";

/** The image part of the request the model was sent. */
function sentImageUrls(): string[] {
  const call = invokeForUserWithReason.mock.calls[0];
  if (!call) return [];
  const content = call[0]?.messages?.[0]?.content as any[];
  if (!Array.isArray(content)) return [];
  return content.filter((part) => part?.type === "image_url").map((part) => part.url);
}

describe("describing the uploaded photos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A provider that can see.
    resolveProviderForUser.mockResolvedValue({
      name: "test",
      capabilities: { vision: true },
    });
    invokeForUserWithReason.mockResolvedValue({ text: "两个人在海边。" });
    storageToDataUrl.mockImplementation(async (url: string) =>
      url === "/uploads/personas/1/2/photo.png"
        ? "data:image/png;base64,AAAA"
        : null,
    );
  });

  it("hands the model the picture itself, not a path it cannot fetch", async () => {
    const described = await describeImages(
      "小A",
      ["/uploads/personas/1/2/photo.png"],
      "openai",
      6,
      "zh",
      1,
    );

    expect(described).toBe("两个人在海边。");
    /**
     * The old code sent the path. A provider cannot fetch it: OpenAI
     * answers "Invalid image URL", and a local model drops the picture
     * and invents a description of a photo it never saw.
     */
    expect(sentImageUrls()).toEqual(["data:image/png;base64,AAAA"]);
  });

  it("does not ask the model about a picture it cannot read", async () => {
    /**
     * A picture that cannot be read is a picture that cannot be
     * described. Asking the model about it anyway is exactly how the
     * invention happens.
     */
    storageToDataUrl.mockResolvedValue(null);

    const described = await describeImages(
      "小A",
      ["/uploads/personas/1/2/missing.png"],
      "openai",
      6,
      "zh",
      1,
    );

    expect(described).toBe("");
    expect(invokeForUserWithReason).not.toHaveBeenCalled();
  });

  it("does not ask a model that cannot see", async () => {
    resolveProviderForUser.mockResolvedValue({
      name: "test",
      capabilities: { vision: false },
    });

    const described = await describeImages(
      "小A",
      ["/uploads/personas/1/2/photo.png"],
      "openai",
      6,
      "zh",
      1,
    );

    expect(described).toBe("");
    expect(invokeForUserWithReason).not.toHaveBeenCalled();
  });
});
