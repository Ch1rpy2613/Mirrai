import { describe, expect, it } from "vitest";
import { isOwnedByUser } from "./uploads";

describe("isOwnedByUser", () => {
  it("allows a user their own uploaded persona file", () => {
    expect(isOwnedByUser("personas/1/2/a.png", 1)).toBe(true);
  });

  it("refuses another user's file", () => {
    expect(isOwnedByUser("personas/2/2/a.png", 1)).toBe(false);
  });

  it("allows a user their own chat media", () => {
    expect(isOwnedByUser("chat/1/2/abc.png", 1)).toBe(true);
    expect(isOwnedByUser("chat/2/2/abc.png", 1)).toBe(false);
  });

  it("allows a user their own speech", () => {
    expect(isOwnedByUser("tts/1/abcdef0123456789.mp3", 1)).toBe(true);
    expect(isOwnedByUser("tts/2/abcdef0123456789.mp3", 1)).toBe(false);
  });

  it("does not let the path decide who owns a legacy speech file", () => {
    // Files written before speech was scoped per user have no owner in
    // their path, and their names are the hash of the text they were
    // made from — so two people who asked for the same words share one
    // file. The path cannot say whose it is; the conversation can.
    expect(isOwnedByUser("tts/legacy/abcdef.mp3", 1)).toBe(false);
  });

  it("refuses an unknown scope", () => {
    expect(isOwnedByUser("secrets/1/a.txt", 1)).toBe(false);
  });

  it("refuses a key with too few segments", () => {
    expect(isOwnedByUser("personas", 1)).toBe(false);
    expect(isOwnedByUser("", 1)).toBe(false);
  });

  it("ignores a leading slash", () => {
    expect(isOwnedByUser("/personas/1/2/a.png", 1)).toBe(true);
  });
});
