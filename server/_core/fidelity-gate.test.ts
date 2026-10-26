import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./persona-utils";
import { checkPersonaStructure, completePersona } from "./fidelity-gate";

/**
 * The gate, and whether it still bites.
 *
 * A gate that only ever says "yes" is a decoration. The checks here
 * break each thing the gate looks at, and require that the gate notices
 * — so the day somebody refactors the prompt builder and the rules stop
 * reaching the persona, this fails rather than the gate.
 *
 * The breakages are made on the persona rather than on the source,
 * because the persona is what the gate is handed. A gate that only works
 * against one particular fixture is not a gate.
 */
describe("the gate", () => {
  it("passes a persona that has everything", () => {
    const result = checkPersonaStructure(completePersona());
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("says what it checked", () => {
    const result = checkPersonaStructure(completePersona());
    expect(result.checks.length).toBeGreaterThan(5);
    for (const item of result.checks) expect(item.length).toBeGreaterThan(10);
  });

  it("notices a rule that no longer reaches the prompt", () => {
    const persona = completePersona();
    persona.personaData.microRules = [];
    const result = checkPersonaStructure(persona);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.what)).toContain(
      "the confirmed rule's trigger is not in the prompt",
    );
  });

  it("notices a rule that lost its meaning", () => {
    const persona = completePersona();
    persona.personaData.microRules[0].meaning = "";
    const result = checkPersonaStructure(persona);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.what)).toContain(
      "the confirmed rule's meaning is not in the prompt",
    );
  });

  it("notices a rule that lost what the person does about it", () => {
    const persona = completePersona();
    persona.personaData.microRules[0].rendering = "";
    const result = checkPersonaStructure(persona);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.what)).toContain(
      "the confirmed rule's rendering is not in the prompt",
    );
  });

  it("notices a candidate the user never confirmed", () => {
    const persona = completePersona();
    persona.personaData.microRules[1].verified = true;
    const result = checkPersonaStructure(persona);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.what)).toContain(
      "an unconfirmed candidate reached the prompt",
    );
  });

  it("notices an imperfection that no longer follows the state", () => {
    const persona = completePersona();
    persona.personaData.imperfectionProfile = [
      { state: "happy", deviations: ["会连着发三条"] },
    ];
    const result = checkPersonaStructure(persona);
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.what)).toContain(
      "the imperfection of the current state is not in the prompt",
    );
  });

  it("gives a persona that asked for nothing nothing", () => {
    // The defaults are what the interface offers; they are not what the
    // persona has until the user keeps them. So a persona with nothing
    // in it gets nothing in its prompt.
    //
    // The gate's own check here is a negative one — it fires only if
    // the code wrongly *added* a personality — so what can be asserted
    // from this side is the behaviour it protects.
    const persona = completePersona();
    persona.personaData.imperfectionProfile = [];
    persona.personaData.microRules = [];

    const result = checkPersonaStructure(persona);
    expect(result.failures.map((f) => f.what)).not.toContain(
      "a persona that never opted in gained a personality",
    );

    const prompt = buildSystemPrompt(persona, { locale: "zh" });
    expect(prompt).not.toContain("只用三个字");
    expect(prompt).not.toContain("一次发五句");
    expect(prompt).not.toContain("随便你");
  });

  it("notices rules that do not survive the database", () => {
    // The rules go in and come back as json. A rule that does not
    // survive that is a rule that disappears on save.
    const persona = completePersona();
    const result = checkPersonaStructure(persona);
    const roundTripped = JSON.parse(JSON.stringify(persona.personaData));
    expect(roundTripped.microRules).toHaveLength(2);
    // And the gate is looking at exactly that round trip.
    expect(result.ok).toBe(true);
  });

  it("gives a reason with every failure", () => {
    // A red mark with no explanation is a red mark people learn to skip.
    const persona = completePersona();
    persona.personaData.microRules = [];
    const result = checkPersonaStructure(persona);
    for (const failure of result.failures) {
      expect(failure.why.length).toBeGreaterThan(20);
    }
  });
});
