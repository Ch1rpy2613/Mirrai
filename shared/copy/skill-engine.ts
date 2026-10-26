/**
 * What the analysis says while it is happening.
 *
 * The distillation runs for minutes, and the interface shows its progress
 * as it goes. Those lines were Chinese only — so an English user watched
 * a progress bar in a language they do not read, with no way to tell
 * whether it had stalled or was working.
 */
import type { CopyTable } from "./index";

export const SKILL_ENGINE = {
  "skill.waitingMaterial": {
    zh: "等待素材...",
    en: "Waiting for material…",
  },
  "skill.takingStock": {
    zh: "正在盘点素材...",
    en: "Taking stock of the material…",
  },
  "skill.analyzingPersona": {
    zh: "正在分析人物性格...",
    en: "Reading the personality…",
  },
  "skill.buildingPortrait": {
    zh: "正在构建人物画像...",
    en: "Building the portrait…",
  },
  "skill.analyzingWork": {
    zh: "正在分析工作维度...",
    en: "Reading the working life…",
  },
  "skill.mergingDimensions": {
    zh: "正在合并工作与人格维度...",
    en: "Joining the work and the person…",
  },
  "skill.integrating": {
    zh: "正在整合结果...",
    en: "Putting it together…",
  },
  "skill.done": {
    zh: "完成",
    en: "Done",
  },
  "skill.retrying": {
    zh: "第 {{attempt}} 次尝试失败，正在重试...",
    en: "Attempt {{attempt}} failed — trying again…",
  },
  "skill.analysisFailed": {
    zh: "性格蒸馏失败，请重试",
    en: "The distillation failed — please try again",
  },
  "skill.researchNote": {
    zh: "## 研究笔记（来自公开资料研究阶段）\n\n{{notes}}",
    en: "## Research notes (from the public-source stage)\n\n{{notes}}",
  },

  /** The research stage — the one that takes the longest. */
} satisfies CopyTable;
