/**
 * Crisis-support resources.
 *
 * IMPORTANT: the numbers below are the ones named in the approved plan, and
 * they are the widely published ones. **Nobody has checked them against the
 * operators themselves.** The `lastVerified` field records when the entry
 * was written, not when a person verified it — and the date in it is a
 * placeholder, not a promise. A human check is still owed before a release
 * goes out: edit this file (or point `SAFETY_RESOURCES_FILE` at your own
 * copy) to correct the numbers, and put the real date in the field.
 *
 * Nothing in this file is fetched from the network: the list ships with the
 * app so it is available even when the machine is offline.
 */
import { existsSync, readFileSync } from "fs";
import { ENV } from "../_core/env";
import { copy } from "@shared/copy";

export interface CrisisResource {
  id: string;
  /** Display label, e.g. "中国大陆". */
  region: string;
  /** The label in the other language, when it has one. */
  regionEn?: string;
  /** What the resource is, in one line. */
  description: string;
  /** The description in the other language, when it has one. */
  descriptionEn?: string;
  /** The contact itself — a phone number or a URL. */
  contact: string;
  /**
   * ISO date the entry was last checked by a human.
   *
   * It is a placeholder in the list that ships with the app: the numbers
   * have not been checked against the operators. The field is kept so that
   * the check has somewhere to be recorded when it happens.
   */
  lastVerified: string;
}

/**
 * The resources that ship with the app.
 *
 * The names, the numbers and the addresses are the part that matters and
 * they never change; the region and the description are labels, and they
 * are read by somebody in a bad moment, so they are in both languages.
 */
export const DEFAULT_CRISIS_RESOURCES: CrisisResource[] = [
  {
    id: "cn-national",
    region: copy("zh", "labels.crisis.region.cnNational"),
    regionEn: copy("en", "labels.crisis.region.cnNational"),
    description: copy("zh", "labels.crisis.description.cnNational"),
    descriptionEn: copy("en", "labels.crisis.description.cnNational"),
    contact: "12356",
    lastVerified: "2026-01-01",
  },
  {
    id: "cn-beijing",
    region: copy("zh", "labels.crisis.region.cnBeijing"),
    regionEn: copy("en", "labels.crisis.region.cnBeijing"),
    description: copy("zh", "labels.crisis.description.cnBeijing"),
    descriptionEn: copy("en", "labels.crisis.description.cnBeijing"),
    contact: "010-8295-1332",
    lastVerified: "2026-01-01",
  },
  {
    id: "intl-directory",
    region: copy("zh", "labels.crisis.region.international"),
    regionEn: copy("en", "labels.crisis.region.international"),
    description: copy("zh", "labels.crisis.description.international"),
    descriptionEn: copy("en", "labels.crisis.description.international"),
    contact: "https://findahelpline.com",
    lastVerified: "2026-01-01",
  },
  {
    id: "us-ca",
    region: copy("zh", "labels.crisis.region.usCanada"),
    regionEn: copy("en", "labels.crisis.region.usCanada"),
    // This one is named in English already: the hotline calls itself
    // that, in both languages.
    description: "Suicide & Crisis Lifeline",
    contact: "988",
    lastVerified: "2026-01-01",
  },
];

let cachedResources: CrisisResource[] | null = null;

/**
 * Returns the resource list, honouring the `SAFETY_RESOURCES_FILE` override.
 */
export function getCrisisResources(): CrisisResource[] {
  if (cachedResources) return cachedResources;

  if (ENV.safetyResourcesFile && existsSync(ENV.safetyResourcesFile)) {
    try {
      const parsed = JSON.parse(readFileSync(ENV.safetyResourcesFile, "utf-8"));
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedResources = parsed as CrisisResource[];
        return cachedResources;
      }
      console.warn(
        "[Safety] SAFETY_RESOURCES_FILE did not contain a non-empty array; using the built-in list.",
      );
    } catch (e) {
      console.warn("[Safety] Failed to read SAFETY_RESOURCES_FILE:", e);
    }
  }

  cachedResources = DEFAULT_CRISIS_RESOURCES;
  return cachedResources;
}

/**
 * Renders the resource list for a reply.
 *
 * The list is read by somebody who is in trouble, so the labels are in
 * the language they read — a region they cannot read is a region they
 * cannot look up.
 */
export function formatResources(
  resources: CrisisResource[] = getCrisisResources(),
  locale: "zh" | "en" = "zh",
): string {
  const separator = locale === "en" ? ": " : "：";
  return resources
    .map((r) => {
      const region = locale === "en" ? r.regionEn ?? r.region : r.region;
      const description = locale === "en" ? r.descriptionEn ?? r.description : r.description;
      return `· ${region} · ${description}${separator}${r.contact}`;
    })
    .join("\n");
}
