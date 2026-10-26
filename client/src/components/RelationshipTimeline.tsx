import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { RELATIONSHIP_EVENT_KINDS, type RelationshipEventKind } from "@shared/user-side";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * What actually happened in the relationship.
 *
 * The app simulated a conversation and remembered the other person's
 * milestones, but it had nowhere to record reality: that they fought, got
 * back together, broke up, or are simply out of touch. The persona's sense
 * of the relationship was frozen at whatever the distillation pipeline
 * decided on the day it ran.
 *
 * These entries are the user's own record. The app does not guess them —
 * guessing would mean inventing a relationship the user did not have.
 */
export default function RelationshipTimeline({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.relationship.list.useQuery({ personaId });
  const invalidate = () => utils.relationship.list.invalidate({ personaId });

  const addEvent = trpc.relationship.add.useMutation({
    onSuccess: () => { toast.success(t("relationship.saved")); invalidate(); setTitle(""); setDetail(""); setKind("news"); },
    onError: (e) => toast.error(e.message),
  });
  const removeEvent = trpc.relationship.remove.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const [kind, setKind] = useState<RelationshipEventKind>("news");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [showForm, setShowForm] = useState(false);

  const events = data?.events ?? [];

  return (
    <div className="space-y-4">
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {/* While the list is still on its way, the panel used to say
              that nothing had been recorded — a false statement about
              the user's own data, made a moment before the real thing
              appeared. */}
          {isLoading ? t("common.loading") : t("relationship.empty")}
        </p>
      ) : (
        <ol className="space-y-3">
          {events.map((event: any) => (
            <li key={event.id} className="group relative pl-5">
              <span className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-primary/60" aria-hidden />
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">
                    {t(`relationship.kinds.${event.kind}` as any)}
                    <span className="text-muted-foreground"> · </span>
                    <span className="font-medium">{event.title}</span>
                  </p>
                  {event.detail && (
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed whitespace-pre-wrap">
                      {event.detail}
                    </p>
                  )}
                  <p className="text-[0.625rem] text-muted-subtle mt-1">
                    {new Date(event.happenedAt).toLocaleDateString(locale)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    // The events are the user's own record of what
                    // happened. They are not thrown away by one click
                    // with nothing said.
                    if (!window.confirm(t("relationship.removeConfirm"))) return;
                    removeEvent.mutate({ id: event.id });
                  }}
                  className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-1"
                  aria-label={t("relationship.remove")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {showForm ? (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="relationship-kind">{t("relationship.kind")}</Label>
            <select
              id="relationship-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as RelationshipEventKind)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            >
              {RELATIONSHIP_EVENT_KINDS.map((k) => (
                <option key={k} value={k}>{t(`relationship.kinds.${k}` as any)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="relationship-title">{t("relationship.title")}</Label>
            <Input
              id="relationship-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("relationship.titlePlaceholder")}
              maxLength={200}
              className="h-9 rounded-md text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="relationship-detail">{t("relationship.detail")}</Label>
            <textarea
              id="relationship-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={t("relationship.detailPlaceholder")}
              maxLength={2000}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 resize-y"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="rounded-md px-5"
              disabled={!title.trim() || addEvent.isPending}
              onClick={() => addEvent.mutate({
                personaId,
                kind,
                title: title.trim(),
                detail: detail.trim() || undefined,
              })}
            >
              {addEvent.isPending ? t("common.saving") : t("common.save")}
            </Button>
            <Button size="sm" variant="ghost" className="rounded-md" onClick={() => setShowForm(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="rounded-md text-xs bg-transparent" onClick={() => setShowForm(true)}>
          <Plus className="w-3.5 h-3.5" /> {t("relationship.add")}
        </Button>
      )}
    </div>
  );
}
