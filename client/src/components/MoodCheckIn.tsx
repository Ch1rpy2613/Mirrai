import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { USER_MOODS, type UserMood } from "@shared/user-side";
import { toast } from "sonner";

/**
 * The mood check-in.
 *
 * The app recorded the *persona's* mood — inferred from what the user said
 * to it — and charted it on the user's own dashboard. The user had nowhere
 * to put how they were actually doing, which is the one thing a person
 * going through something needs a place for.
 *
 * Six taps, no typing required. A note is optional.
 */

/** The face each mood gets. Deliberately plain, so it reads the same in
 *  every language and does not pretend to be more precise than it is. */
const MOOD_FACES: Record<UserMood, string> = {
  great: "◕‿◕",
  okay: "—",
  low: "︵",
  down: "﹏",
  anxious: "〰",
  numb: "·",
};

export interface MoodCheckInProps {
  /** A compact one-line strip for the home screen. */
  compact?: boolean;
}

export default function MoodCheckIn({ compact = false }: MoodCheckInProps) {
  const { t } = useLocale();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  const setMood = trpc.user.setMood.useMutation({
    onSuccess: () => {
      toast.success(t("moodCheckIn.saved"));
      setNote("");
      setShowNote(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const choose = (mood: UserMood) => {
    setMood.mutate({ mood, note: note.trim() || undefined });
  };

  return (
    <div className="space-y-3">
      {!compact && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("moodCheckIn.hint")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {USER_MOODS.map((mood) => (
          <button
            key={mood}
            type="button"
            onClick={() => choose(mood)}
            disabled={setMood.isPending}
            title={t(`moodCheckIn.moods.${mood}` as any)}
            className="flex flex-col items-center gap-1 rounded-xl border border-border bg-background px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <span aria-hidden className="text-base leading-none">{MOOD_FACES[mood]}</span>
            <span>{t(`moodCheckIn.moods.${mood}` as any)}</span>
          </button>
        ))}
      </div>

      {showNote ? (
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("moodCheckIn.notePlaceholder")}
            aria-label={t("moodCheckIn.notePlaceholder")}
            maxLength={280}
            className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={() => {
              // The note is thrown away, not just hidden.
              //
              // Cancelling only closed the field, so the text stayed in
              // the state and was written to the next mood the user
              // chose — a note they had said "never mind" about.
              setNote("");
              setShowNote(false);
            }}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNote(true)}
          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {t("moodCheckIn.addNote")}
        </button>
      )}
    </div>
  );
}
