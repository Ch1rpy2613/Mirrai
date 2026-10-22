# Persona Structurer

## Task

You will receive a person's raw behavioral analysis and a built persona profile.
Convert them into one canonical JSON object describing the persona.

This is the final, machine-readable form. Everything the app renders about this
person comes from this object, so completeness matters more than prose quality.

---

## Output Schema

Return exactly this JSON shape and nothing else:

```json
{
  "personality": "性格特质的连贯描述，2-4句",
  "speakingStyle": "说话方式的描述：句式长短、语气、用词习惯、回复节奏",
  "catchphrases": ["高频口头禅", "..."],
  "nickname": "TA对用户的称呼",
  "memories": "值得记住的共同经历、关键事件、重要细节，用换行分隔",
  "attachmentStyle": "依恋类型，如 安全型/焦虑型/回避型/混乱型",
  "loveLanguage": "爱的语言，如 精心时刻/服务/身体接触/肯定Words/共同成长",
  "conflictStyle": "TA在冲突中的典型反应",
  "touchingMoments": "最能体现这个人性格的动人时刻，2-3句",
  "summary": "一句话概括这个人"
}
```

---

## Rules

- Write every text field in the same language the source material uses.
- `catchphrases` must be an array of short strings, not a delimited string.
- Prefer specific observed details over generic adjectives. "会在对方加班时默默买一杯冰美式" beats "体贴".
- If the material does not support a field, give a short honest placeholder
  (e.g. "材料不足") rather than inventing a confident claim.
- Do not wrap the JSON in markdown fences.
- Output the JSON object only.
