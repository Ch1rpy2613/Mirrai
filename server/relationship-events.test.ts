import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The relationship events.
 *
 * These are the user's own record of what happened between the two of
 * them — a breakup they wrote down, a reunion, a fight that got fixed.
 * The app reads them to know where the relationship stands, so a breakup
 * written down has to be as final as an end date that was filled in.
 *
 * The writing was untested. The reading was.
 *
 * The store below is a miniature one that mirrors the SQL predicate it
 * stands in for: a row comes back only when the caller's user id
 * matches the row's owner.
 */
const store: { events: any[]; personas: any[] } = { events: [], personas: [] };
let nextId = 1;

const getRelationshipEvents = vi.fn(async (personaId: number, userId: number, limit = 50) =>
  store.events
    .filter((e) => e.personaId === personaId && e.userId === userId)
    .sort((a, b) => b.happenedAt.getTime() - a.happenedAt.getTime())
    .slice(0, limit),
);

const createRelationshipEvent = vi.fn(async (params: any) => {
  const row = {
    id: nextId++,
    userId: params.userId,
    personaId: params.personaId,
    kind: params.kind,
    title: params.title,
    detail: params.detail ?? null,
    happenedAt: params.happenedAt ?? new Date(),
    recordedAt: new Date(),
  };
  store.events.push(row);
  return row;
});

const deleteRelationshipEvent = vi.fn(async (id: number, userId: number) => {
  const index = store.events.findIndex((e) => e.id === id && e.userId === userId);
  if (index === -1) return false;
  store.events.splice(index, 1);
  return true;
});

const getPersonaById = vi.fn(async (id: number, userId: number) =>
  store.personas.find((p) => p.id === id && p.userId === userId),
);

const updatePersona = vi.fn(async (id: number, userId: number, data: any) => {
  const persona = store.personas.find((p) => p.id === id && p.userId === userId);
  if (!persona) return null;
  Object.assign(persona, data);
  return persona;
});

vi.mock("./db", () => ({
  getRelationshipEvents: (...a: any[]) => getRelationshipEvents(...(a as [any, any, any])),
  createRelationshipEvent: (...a: any[]) => createRelationshipEvent(...(a as [any])),
  deleteRelationshipEvent: (...a: any[]) => deleteRelationshipEvent(...(a as [any, any])),
  getPersonaById: (...a: any[]) => getPersonaById(...(a as [any, any])),
  updatePersona: (...a: any[]) => updatePersona(...(a as [any, any, any])),
}));

import { appRouter } from "./routers";

const callerFor = (userId: number) =>
  appRouter.createCaller({
    req: { headers: {} } as any,
    res: {} as any,
    user: { id: userId, name: "someone" } as any,
    locale: "en" as const,
  } as any);

describe("the relationship events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextId = 1;
    store.events = [];
    store.personas = [{ id: 5, userId: 1, name: "小A", togetherTo: null }];
  });

  it("records the event against the user and the persona", async () => {
    const caller = callerFor(1);
    await caller.relationship.add({
      personaId: 5,
      kind: "conflict",
      title: "吵了一架",
      detail: "因为一件很小的事",
    });

    expect(createRelationshipEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        personaId: 5,
        kind: "conflict",
        title: "吵了一架",
        detail: "因为一件很小的事",
      }),
    );
  });

  it("reads the events back", async () => {
    const caller = callerFor(1);
    await caller.relationship.add({ personaId: 5, kind: "meetup", title: "见了面" });

    const { events } = await caller.relationship.list({ personaId: 5 });
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("见了面");
  });

  it("does not show one user another user's events", async () => {
    const first = callerFor(1);
    await first.relationship.add({ personaId: 5, kind: "meetup", title: "见了面" });

    // The store filters on the user id, so a second user sees nothing.
    const second = callerFor(2);
    const { events } = await second.relationship.list({ personaId: 5 });
    expect(events).toHaveLength(0);
  });

  it("refuses to record an event for a persona that is not the caller's", async () => {
    const second = callerFor(2);
    await expect(
      second.relationship.add({ personaId: 5, kind: "meetup", title: "见了面" }),
    ).rejects.toThrow();
    expect(createRelationshipEvent).not.toHaveBeenCalled();
  });

  it("sets the end date when a breakup is written down", async () => {
    // A breakup the user records is as final as an end date they filled
    // in, and the app has to stop treating the two of them as together.
    const caller = callerFor(1);
    await caller.relationship.add({ personaId: 5, kind: "breakup", title: "我们分手了" });

    expect(updatePersona).toHaveBeenCalledWith(
      5,
      1,
      expect.objectContaining({ togetherTo: expect.any(String) }),
    );
  });

  it("does not set the end date for a quarrel", async () => {
    const caller = callerFor(1);
    await caller.relationship.add({ personaId: 5, kind: "conflict", title: "吵了一架" });

    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("removes an event", async () => {
    const caller = callerFor(1);
    await caller.relationship.add({ personaId: 5, kind: "meetup", title: "见了面" });
    const { events } = await caller.relationship.list({ personaId: 5 });

    await caller.relationship.remove({ id: events[0].id });

    const after = await caller.relationship.list({ personaId: 5 });
    expect(after.events).toHaveLength(0);
  });

  it("does not remove another user's event", async () => {
    const first = callerFor(1);
    await first.relationship.add({ personaId: 5, kind: "meetup", title: "见了面" });
    const { events } = await first.relationship.list({ personaId: 5 });

    const second = callerFor(2);
    // It is not found, rather than found-and-refused: a second user
    // should not even learn that the event exists.
    await expect(second.relationship.remove({ id: events[0].id })).rejects.toThrow();

    const after = await first.relationship.list({ personaId: 5 });
    expect(after.events).toHaveLength(1);
  });
});
