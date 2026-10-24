/**
 * The persona template format.
 *
 * A template is a persona that has been generalised — a starting point
 * rather than somebody's actual chat history. Templates are local files and
 * local rows: the product's rule is that user data never leaves the machine,
 * so there is deliberately no remote marketplace here.
 */
import type { PersonaData } from "../_core/persona-schema";

export const TEMPLATE_SCHEMA_VERSION = 1;

export interface PersonaTemplate {
  schemaVersion: number;
  /** Stable identifier, unique within the library. */
  id: string;
  name: string;
  /** Which distillation family the template suits. */
  family: "colleague" | "relationship" | "celebrity";
  description: string;
  tags: string[];
  /** The persona this template creates. */
  personaData: PersonaData;
  /** Optional scenes shipped with the template. */
  scenePack?: Array<{
    name: string;
    icon?: string;
    description?: string;
    systemPromptOverlay?: string;
    starters?: string[];
  }>;
  author?: string;
  license?: string;
}

export interface TemplateValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Checks that an unknown object is a usable template.
 *
 * Used by the import path, where the file may come from anywhere.
 */
export function validateTemplate(value: unknown): TemplateValidationResult {
  if (!value || typeof value !== "object") {
    return { ok: false, error: "模板必须是一个对象" };
  }
  const candidate = value as Partial<PersonaTemplate>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    return { ok: false, error: "模板缺少 id" };
  }
  if (typeof candidate.name !== "string" || !candidate.name.trim()) {
    return { ok: false, error: "模板缺少 name" };
  }
  if (!candidate.personaData || typeof candidate.personaData !== "object") {
    return { ok: false, error: "模板缺少 personaData" };
  }
  if (
    candidate.family !== "colleague" &&
    candidate.family !== "relationship" &&
    candidate.family !== "celebrity"
  ) {
    return { ok: false, error: "模板的 family 必须是 colleague / relationship / celebrity" };
  }
  return { ok: true };
}

/**
 * Normalises a template, filling in the optional parts.
 */
export function normalizeTemplate(value: unknown): PersonaTemplate {
  const candidate = (value ?? {}) as Partial<PersonaTemplate>;
  return {
    schemaVersion: candidate.schemaVersion ?? TEMPLATE_SCHEMA_VERSION,
    id: String(candidate.id ?? "").trim(),
    name: String(candidate.name ?? "").trim(),
    family: (candidate.family ?? "relationship") as PersonaTemplate["family"],
    description: String(candidate.description ?? ""),
    tags: Array.isArray(candidate.tags) ? candidate.tags.map(String) : [],
    personaData: candidate.personaData as PersonaData,
    scenePack: Array.isArray(candidate.scenePack) ? candidate.scenePack : undefined,
    author: candidate.author,
    license: candidate.license,
  };
}
