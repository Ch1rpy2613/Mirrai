/**
 * What the app pushes without being asked.
 *
 * A reminder arrives on its own, at the moment it chooses, and it lands
 * in a phone or a chat window. It was Chinese only — so an English
 * user's anniversary arrived in Chinese, which is not a small thing on
 * the day it matters.
 */
import type { CopyTable } from "./index";

export const REMINDERS = {
  "reminders.anniversary": {
    zh: "今天是「{{title}}」的日子。",
    en: "Today is the day of “{{title}}”.",
  },
  "reminders.togetherYears": {
    zh: "今天是你和 {{name}} 认识的第 {{years}} 年。",
    en: "Today is the {{years}}-year mark of you and {{name}}.",
  },
  "reminders.photoOnThisDay": {
    zh: "你给 {{name}} 看过的「{{label}}」，是这一天拍下的。",
    en: "The “{{label}}” you showed {{name}} was taken on this day.",
  },
  "reminders.photoFallbackLabel": {
    zh: "那张照片",
    en: "that photo",
  },
} satisfies CopyTable;
