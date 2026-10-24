/**
 * The six emotional states, defined once.
 *
 * The labels and descriptions live in the dictionary (`emotions.*`) so they
 * can be localised — `labelKey` / `descKey` point at them.
 *
 * The CSS variables and the Tailwind class names must stay literal strings:
 * Tailwind scans the source files for class names, so a computed class name
 * would never make it into the stylesheet.
 */
import {
  CloudRain,
  Flower2,
  Laugh,
  Moon,
  Snowflake,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type EmotionKey =
  | "warm"
  | "playful"
  | "nostalgic"
  | "melancholy"
  | "happy"
  | "distant";

/* The trigger words that decide a state live in the shared module, so the
   client and the server recognise the same words. */
export {
  EMOTION_TRIGGER_PATTERNS,
  EMOTION_TRIGGER_STATES,
  EMOTION_TRIGGER_WORDS,
  matchEmotionTrigger,
  type EmotionTriggerState,
} from "@shared/emotion-triggers";

export type EmotionDefinition = {
  /** The dictionary key of the state's label. */
  labelKey:
    | "emotions.warm.label"
    | "emotions.playful.label"
    | "emotions.nostalgic.label"
    | "emotions.melancholy.label"
    | "emotions.happy.label"
    | "emotions.distant.label";
  /** The dictionary key of the state's description. */
  descKey:
    | "emotions.warm.desc"
    | "emotions.playful.desc"
    | "emotions.nostalgic.desc"
    | "emotions.melancholy.desc"
    | "emotions.happy.desc"
    | "emotions.distant.desc";
  /** The design-system token that carries the state's colour. */
  cssVar: string;
  /** The chip shown next to a label. */
  chip: string;
  /** The small coloured dot. */
  dot: string;
  /** The icon used in the lobby. */
  icon: LucideIcon;
};

export const EMOTIONS: Record<EmotionKey, EmotionDefinition> = {
  warm: {
    labelKey: "emotions.warm.label",
    descKey: "emotions.warm.desc",
    cssVar: "--color-mood-warm",
    chip: "text-mood-warm bg-mood-warm/10 border-mood-warm/30",
    dot: "bg-mood-warm",
    icon: Flower2,
  },
  playful: {
    labelKey: "emotions.playful.label",
    descKey: "emotions.playful.desc",
    cssVar: "--color-mood-playful",
    chip: "text-mood-playful bg-mood-playful/10 border-mood-playful/30",
    dot: "bg-mood-playful",
    icon: Laugh,
  },
  nostalgic: {
    labelKey: "emotions.nostalgic.label",
    descKey: "emotions.nostalgic.desc",
    cssVar: "--color-mood-nostalgic",
    chip: "text-mood-nostalgic bg-mood-nostalgic/10 border-mood-nostalgic/30",
    dot: "bg-mood-nostalgic",
    icon: Moon,
  },
  melancholy: {
    labelKey: "emotions.melancholy.label",
    descKey: "emotions.melancholy.desc",
    cssVar: "--color-mood-melancholy",
    chip: "text-mood-melancholy bg-mood-melancholy/10 border-mood-melancholy/30",
    dot: "bg-mood-melancholy",
    icon: CloudRain,
  },
  happy: {
    labelKey: "emotions.happy.label",
    descKey: "emotions.happy.desc",
    cssVar: "--color-mood-happy",
    chip: "text-mood-happy bg-mood-happy/10 border-mood-happy/30",
    dot: "bg-mood-happy",
    icon: Sparkles,
  },
  distant: {
    labelKey: "emotions.distant.label",
    descKey: "emotions.distant.desc",
    cssVar: "--color-mood-distant",
    chip: "text-mood-distant bg-mood-distant/10 border-mood-distant/30",
    dot: "bg-mood-distant",
    icon: Snowflake,
  },
};

/** The states in a stable order — the charts rely on it. */
export const EMOTION_KEYS = Object.keys(EMOTIONS) as EmotionKey[];

/** The colour of a state, as a CSS value. */
export function emotionColor(state: string | null | undefined): string {
  const key = (state ?? "warm") as EmotionKey;
  const definition = EMOTIONS[key];
  return definition ? `var(${definition.cssVar})` : "var(--color-muted-foreground)";
}
