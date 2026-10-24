/**
 * Crisis-support resources.
 *
 * IMPORTANT: the numbers below are the ones named in the approved plan. They
 * have not been re-verified against the operators themselves — the
 * `lastVerified` field records that they still need a human check before a
 * release goes out. Edit this file (or point `SAFETY_RESOURCES_FILE` at your
 * own copy) to correct them.
 *
 * Nothing in this file is fetched from the network: the list ships with the
 * app so it is available even when the machine is offline.
 */
import { existsSync, readFileSync } from "fs";
import { ENV } from "../_core/env";

export interface CrisisResource {
  id: string;
  /** Display label, e.g. "中国大陆". */
  region: string;
  /** What the resource is, in one line. */
  description: string;
  /** The contact itself — a phone number or a URL. */
  contact: string;
  /** ISO date the entry was last checked by a human. */
  lastVerified: string;
}

export const DEFAULT_CRISIS_RESOURCES: CrisisResource[] = [
  {
    id: "cn-national",
    region: "中国大陆",
    description: "全国心理援助热线",
    contact: "12356",
    lastVerified: "2026-01-01",
  },
  {
    id: "cn-beijing",
    region: "北京",
    description: "心理危机研究与干预中心",
    contact: "010-8295-1332",
    lastVerified: "2026-01-01",
  },
  {
    id: "intl-directory",
    region: "国际",
    description: "按所在国家查找当地热线",
    contact: "https://findahelpline.com",
    lastVerified: "2026-01-01",
  },
  {
    id: "us-ca",
    region: "美国 / 加拿大",
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

/** Renders the resource list for a reply. */
export function formatResources(resources: CrisisResource[] = getCrisisResources()): string {
  return resources
    .map((r) => `· ${r.region} · ${r.description}：${r.contact}`)
    .join("\n");
}
