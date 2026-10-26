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
  "skill.researchFailed": {
    zh: "研究阶段未产出心智模型。",
    en: "The research stage did not produce a mental model.",
  },
  "skill.noKnownQuestions": {
    zh: "研究阶段未产出已知答案问题。",
    en: "The research stage did not produce any questions to answer.",
  },
  "skill.researchNote": {
    zh: "## 研究笔记（来自公开资料研究阶段）\n\n{{notes}}",
    en: "## Research notes (from the public-source stage)\n\n{{notes}}",
  },

  /** The research stage — the one that takes the longest. */
  "research.searching": {
    zh: "正在查找公开资料...",
    en: "Looking through public sources…",
  },
  "research.reading": {
    zh: "正在阅读第 {{index}} / {{total}} 篇...",
    en: "Reading {{index}} of {{total}}…",
  },
  "research.noSources": {
    zh: "没有找到足够的公开资料",
    en: "Not enough public sources were found",
  },
  "research.summarising": {
    zh: "正在整理研究结果...",
    en: "Putting the research together…",
  },
  "research.failed": {
    zh: "研究阶段失败：{{reason}}",
    en: "The research stage failed: {{reason}}",
  },
  "research.quotaExhausted": {
    zh: "研究额度用尽，已跳过这一阶段",
    en: "The research allowance ran out — this stage was skipped",
  },
  "research.extractingPerson": {
    zh: "正在提取人物特征...",
    en: "Pulling out the details of the person…",
  },
  "research.extractingRelations": {
    zh: "正在梳理人物关系...",
    en: "Mapping the people around them…",
  },
  "research.extractingEvents": {
    zh: "正在整理重要事件...",
    en: "Collecting the important events…",
  },
  "research.extractingQuotes": {
    zh: "正在收集原话...",
    en: "Collecting what they actually said…",
  },
  "research.writingDigest": {
    zh: "正在写成研究摘要...",
    en: "Writing the research digest…",
  },
  "research.sourcesFound": {
    zh: "找到了 {{count}} 篇资料",
    en: "Found {{count}} sources",
  },
  "research.sourceTitle": {
    zh: "资料 {{index}}：{{title}}",
    en: "Source {{index}}: {{title}}",
  },
} satisfies CopyTable;
