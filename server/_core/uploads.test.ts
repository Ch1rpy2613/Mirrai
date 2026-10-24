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

  it("allows the legacy speech folder to any signed-in user", () => {
    // Files written before speech was scoped per user. They stay readable so
    // old history still plays.
    expect(isOwnedByUser("tts/legacy/abcdef.mp3", 1)).toBe(true);
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
