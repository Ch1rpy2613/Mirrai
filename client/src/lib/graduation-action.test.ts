import { describe, expect, it } from "vitest";
import { declinesOnCancel } from "./graduation-action";

/**
 * The farewell dialog.
 *
 * The app offering a farewell and the user starting one are different
 * moments, and backing out of them means different things. Declining a
 * suggestion has to be recorded — otherwise the app offers it again on the
 * next turn. Backing out of a farewell the user started themselves must
 * not be recorded: it would mark the persona as "declined" and close the
 * door the manual mode exists to keep open.
 */
describe("backing out of the farewell dialog", () => {
  it("records a decline when the app made the offer", () => {
    expect(declinesOnCancel("suggest")).toBe(true);
  });

  it("records nothing when the user started it themselves", () => {
    expect(declinesOnCancel("manual")).toBe(false);
  });
});
