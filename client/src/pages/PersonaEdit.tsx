import { useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Save, Eye, X, Plus, Download, Upload, PauseCircle, PlayCircle
} from "lucide-react";
import { toast } from "sonner";
import PageLoader from "@/components/PageLoader";
import GraduationModeSelect, {
  graduationModeNoteKey,
} from "@/components/GraduationModeSelect";
import { isPresence, type Presence } from "@shared/graduation-mode";
import { isReachability, type Reachability } from "@shared/user-side";
import RelationshipTimeline from "@/components/RelationshipTimeline";
import LetterBox from "@/components/LetterBox";
import MicroRulesEditor from "@/components/MicroRulesEditor";
import ImperfectionEditor from "@/components/ImperfectionEditor";
import { useLocale } from "@/contexts/LocaleContext";
import type { GraduationMode } from "@shared/graduation-mode";

/* The values written to the persona, not display strings — the server stores
   them verbatim. The labels the user sees come from the dictionary. */
import { ATTACHMENT_STYLES, LOVE_LANGUAGES } from "@/lib/persona-options";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition-[color,box-shadow,border-color,background] focus-visible:border-ring focus-visible:ring-ring/35 focus-visible:ring-[3px] dark:bg-input/35";

/** Reads a file as base64, without the data-URL prefix. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Downloads a base64 payload as a file. */
function downloadBase64(fileName: string, base64: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The download starts asynchronously, so the URL is released a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const { t } = useLocale();
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (v && !tags.includes(v)) { onChange([...tags, v]); setInput(""); }
  };
  return (
    <div className="space-y-2.5">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-border bg-card text-foreground/80">
              {tag}
              <button onClick={() => onChange(tags.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-destructive transition-colors">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={t("personaEdit.tagPlaceholder")} className="h-8 text-sm flex-1" />
        <Button size="sm" variant="ghost" onClick={add} className="h-8 px-2 rounded-md">
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function PersonaEdit() {
  const params = useParams<{ id: string }>();
  const personaId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const { t } = useLocale();

  const { data: persona, refetch } = trpc.persona.get.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const { data: promptData } = trpc.persona.getSystemPrompt.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const providers = trpc.llmConfig.listProviders.useQuery();

  const updateMutation = trpc.persona.update.useMutation({
    onSuccess: () => { toast.success(t("personaEdit.basicSaved")); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateDataMutation = trpc.persona.updatePersonaData.useMutation({
    onSuccess: () => { toast.success(t("personaEdit.dataSaved")); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  /* The graduation mode is a setting of its own: it decides whether the
     app may raise a farewell, and it has to be changeable without touching
     the rest of the profile. */
  const graduationModeMutation = trpc.persona.update.useMutation({
    onSuccess: () => { toast.success(t("graduationMode.saved")); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const graduateMutation = trpc.persona.graduate.useMutation({
    onSuccess: (data) => {
      toast.success(t("graduation.sent"));
      setFarewellLetter(data.farewellLetter);
      // A letter that came out of the single-pass fallback is plainer
      // than the one the two passes write. Saying so is better than
      // passing one thing off as another.
      if (data.degraded) toast.info(t("graduationPage.simplified"));
    },
    onError: (e: any) => toast.error(e.message),
  });

  /**
   * The correction loop: the user says what is wrong, the model turns it
   * into a patch on the persona fields.
   */
  const correctionMutation = trpc.persona.applyCorrection.useMutation({
    onSuccess: (result) => {
      if ("applied" in result && result.applied === false) {
        toast.info(String(result.question || t("personaEdit.correctionUnclear")));
        return;
      }
      toast.success(t("personaEdit.correctionApplied"));
      setCorrection("");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: correctionLog } = trpc.persona.correctionLog.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );

  /* The graduation mode: this persona's own override of the instance-wide
     default, and the mode that is in effect right now. */
  const { data: graduation } = trpc.persona.graduationMode.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  /** The mode in effect right now — the persona's own, or the inherited one. */
  const effectiveGraduationMode: GraduationMode = graduation?.mode ?? "suggest";

  const [name, setName] = useState("");
  const [relationshipDesc, setRelationshipDesc] = useState("");
  const [togetherFrom, setTogetherFrom] = useState("");
  const [togetherTo, setTogetherTo] = useState("");
  const [llmProvider, setLlmProvider] = useState("");
  const [personality, setPersonality] = useState("");
  const [speakingStyle, setSpeakingStyle] = useState("");
  const [catchphrases, setCatchphrases] = useState<string[]>([]);
  const [nickname, setNickname] = useState("");
  const [memories, setMemories] = useState("");
  const [attachmentStyle, setAttachmentStyle] = useState("");
  const [loveLanguage, setLoveLanguage] = useState("");
  const [conflictStyle, setConflictStyle] = useState("");
  const [touchingMoments, setTouchingMoments] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [starterQuestions, setStarterQuestions] = useState<string[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [correction, setCorrection] = useState("");
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [graduationMode, setGraduationMode] = useState<GraduationMode | "inherit">("inherit");
  const [presence, setPresence] = useState<Presence>("active");
  const [reachability, setReachability] = useState<Reachability>("reachable");
  const [proactiveHours, setProactiveHours] = useState(0);
  /** How much the persona writes like a person typing. */
  const [realismLevel, setRealismLevel] = useState(70);
  const [timezone, setTimezone] = useState("");
  const [farewellLetter, setFarewellLetter] = useState<string | null>(null);

  /**
   * The mode that will be in effect once the choice above is saved.
   *
   * The button below follows this one rather than the saved value, so it
   * disappears the moment "off" is picked instead of after the save.
   */
  const pendingGraduationMode: GraduationMode =
    graduationMode === "inherit" ? effectiveGraduationMode : graduationMode;

  /* The character card: the persona can be exported as a PNG card other
     tools understand, and such a card can be imported back. */
  const cardInputRef = useRef<HTMLInputElement>(null);

  const exportCardMutation = trpc.personaCard.export.useMutation({
    onSuccess: (result) => {
      try {
        downloadBase64(result.fileName || `${name}.png`, result.fileContent);
        toast.success(t("personaCard.exported"));
      } catch (e) {
        toast.error(t("personaCard.exportFailed", { message: (e as Error).message }));
      }
    },
    onError: (e: any) => toast.error(t("personaCard.exportFailed", { message: e.message })),
  });

  const importCardMutation = trpc.personaCard.import.useMutation({
    onSuccess: (result) => {
      toast.success(t("personaCard.imported"));
      navigate(`/persona/${result.personaId}/edit`);
    },
    onError: (e: any) => toast.error(t("personaCard.importFailed", { message: e.message })),
  });

  const handleCardFile = async (file: File) => {
    let fileContent: string;
    try {
      fileContent = await fileToBase64(file);
    } catch (e) {
      toast.error(t("personaCard.importFailed", { message: (e as Error).message }));
      return;
    }
    // The mutation reports its own success and failure.
    importCardMutation.mutate({ fileContent });
  };

  /**
   * Whether the form has been filled in from the server.
   *
   * The effect below fills every field in from the persona, and the
   * persona changes whenever one of the mutations refetches it. So
   * typing a new personality and then pressing the "hold" button threw
   * the typing away: the refetch arrived, the effect ran, and every
   * field was set back to the last saved value.
   *
   * The form is filled in once. Everything the user does afterwards
   * changes the form directly, so nothing is lost.
   */
  const formFilled = useRef(false);

  useEffect(() => {
    if (!persona || formFilled.current) return;
    formFilled.current = true;
    setName(persona.name || "");
    setRelationshipDesc(persona.relationshipDesc || "");
    setTogetherFrom(persona.togetherFrom || "");
    setTogetherTo(persona.togetherTo || "");
    setLlmProvider((persona as any).llmProvider || "");
    setRemindersEnabled(persona.remindersEnabled !== false);
    setGraduationMode((persona.graduationMode as GraduationMode) ?? "inherit");
    setPresence(isPresence(persona.presence) ? persona.presence : "active");
    setReachability(isReachability(persona.reachability) ? persona.reachability : "reachable");
    setProactiveHours((persona as any).proactiveFrequencyHours ?? 0);
    setRealismLevel(((persona.personaData as any)?.realismLevel ?? 70));
    setTimezone(persona.timezone ?? "");
    const p = (persona.personaData as any) || {};
    setPersonality(p.personality || "");
    setSpeakingStyle(p.speakingStyle || "");
    setCatchphrases(p.catchphrases || []);
    setNickname(p.nickname || "");
    setMemories(p.memories || "");
    setAttachmentStyle(p.attachmentStyle || "");
    setLoveLanguage(p.loveLanguage || "");
    setConflictStyle(p.conflictStyle || "");
    setTouchingMoments(p.touchingMoments || "");
    setCustomInstructions(p.customInstructions || "");
    setStarterQuestions(p.starterQuestions || []);
  }, [persona]);

  const saveBasic = () => updateMutation.mutate({
    id: personaId, name, relationshipDesc,
    togetherFrom: togetherFrom || undefined, togetherTo: togetherTo || undefined,
    llmProvider: llmProvider || undefined,
    remindersEnabled,
    presence,
    reachability,
    proactiveFrequencyHours: proactiveHours,
    timezone: timezone || null,
  });

  const savePersonaData = () => updateDataMutation.mutate({
    id: personaId,
    personaData: { personality, speakingStyle, catchphrases, nickname, memories,
      realismLevel,
      attachmentStyle, loveLanguage, conflictStyle, touchingMoments, customInstructions, starterQuestions },
  });

  if (!persona) return <PageLoader />;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")}
            className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">{t("common.back")}</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-title-group">
            <div>
              <p className="kicker">{t("personaEdit.kicker")}</p>
              <p className="app-nav-title">{persona.name}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container page-main max-w-3xl space-y-6">
        {/* Page Intro */}
        <div className="animate-fade-in-up">
          <p className="kicker kicker-accent mb-3">{t("personaEdit.profileKicker")}</p>
          <h1 className="page-title">{t("personaEdit.title")}</h1>
          <p className="text-muted-foreground text-sm mt-2.5 leading-relaxed">
            {t("personaEdit.intro")}
          </p>
          <hr className="rule w-16 mt-6" />
        </div>

        {/* Basic Info */}
        <section className="surface p-5 sm:p-6 space-y-5 animate-fade-in-up">
          <div>
            <h2 className="section-title">{t("personaEdit.basicTitle")}</h2>
            <p className="text-muted-foreground text-sm mt-1">{t("personaEdit.basicNote")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.name")}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.relationship")}</Label>
              <Input value={relationshipDesc} onChange={e => setRelationshipDesc(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.togetherFromLabel")}</Label>
              <Input type="date" value={togetherFrom} onChange={e => setTogetherFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.togetherToLabel")}</Label>
              <Input type="date" value={togetherTo} onChange={e => setTogetherTo(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("personaEdit.providerLabel")}</Label>
            <select value={llmProvider} onChange={e => setLlmProvider(e.target.value)}
              className={selectClass}>
              <option value="">{t("personaEdit.providerDefault")}</option>
              {providers.data?.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          {/* Proactive reminders are per persona — some relationships want
              silence on an anniversary. */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={remindersEnabled}
              onChange={e => setRemindersEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-border accent-primary" />
            <span className="text-xs text-muted-foreground">{t("personaEdit.remindersEnabled")}</span>
          </label>
          {/* 「先缓一缓」 — a deliberate action, not a dropdown value.
              It is the thing a person reaches for on a bad week, and it
              has to be obvious exactly what it stops and what it does
              not: the app goes quiet, the conversation does not. */}
          <div className="rounded-lg border border-border/70 p-3.5 space-y-2.5">
            <div className="flex items-start gap-2.5">
              <PauseCircle className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{t("presence.label")}</p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                  {t("presence.holdNote")}
                </p>
                <ul className="text-xs text-muted-foreground/85 leading-relaxed mt-1.5 space-y-0.5">
                  <li>· {t("presence.holdStops")}</li>
                  <li>· {t("presence.holdKeeps")}</li>
                </ul>
              </div>
            </div>
            <div className="flex gap-2">
              {presence === "quiet" ? (
                <Button size="sm" variant="outline" className="rounded-md bg-transparent"
                  onClick={() => { setPresence("active"); updateMutation.mutate({ id: personaId, presence: "active" }); }}>
                  <PlayCircle className="w-3.5 h-3.5" /> {t("presence.holdBack")}
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="rounded-md bg-transparent"
                  onClick={() => { setPresence("quiet"); updateMutation.mutate({ id: personaId, presence: "quiet" }); }}>
                  <PauseCircle className="w-3.5 h-3.5" /> {t("presence.hold")}
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("proactive.label")}</Label>
            <select value={String(proactiveHours)} onChange={e => setProactiveHours(Number(e.target.value))}
              className={selectClass}>
              <option value="0">{t("proactive.off")}</option>
              <option value="24">{t("proactive.daily")}</option>
              <option value="72">{t("proactive.everyThreeDays")}</option>
              <option value="168">{t("proactive.weekly")}</option>
            </select>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("proactive.note")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("reachability.label")}</Label>
            <select value={reachability} onChange={e => setReachability(e.target.value as Reachability)}
              className={selectClass}>
              <option value="reachable">{t("reachability.reachable")}</option>
              <option value="unreachable">{t("reachability.unreachable")}</option>
            </select>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t(reachability === "unreachable" ? "reachability.unreachableNote" : "reachability.reachableNote")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">{t("personaEdit.timezoneLabel")}</Label>
            <Input value={timezone} onChange={e => setTimezone(e.target.value)}
              placeholder={t("personaEdit.timezonePlaceholder")} />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("personaEdit.timezoneNote")}
            </p>
          </div>
          <Button size="sm" onClick={saveBasic} disabled={updateMutation.isPending}
            className="rounded-md px-5">
            <Save className="w-3.5 h-3.5" />{updateMutation.isPending ? t("common.saving") : t("personaEdit.saveBasic")}
          </Button>
        </section>

        {/* The letters. A letter that is kept and never answered, and a
            letter that is delivered, are two different acts. */}
        <section className="surface p-5 sm:p-6 space-y-5 animate-fade-in-up">
          <div>
            <h2 className="section-title">{t("letters.title")}</h2>
            <p className="text-muted-foreground text-sm mt-1">{t("letters.note")}</p>
          </div>
          <LetterBox personaId={personaId} />
        </section>

        {/* What actually happened. Without this the persona's sense of the
            relationship is frozen at whatever the pipeline decided. */}
        <section className="surface p-5 sm:p-6 space-y-5 animate-fade-in-up">
          <div>
            <h2 className="section-title">{t("relationship.title")}</h2>
            <p className="text-muted-foreground text-sm mt-1">{t("relationship.note")}</p>
          </div>
          <RelationshipTimeline personaId={personaId} />
        </section>

        {/* Graduation mode — how much the app may bring a farewell up. */}
        <section className="surface p-5 sm:p-6 space-y-5 animate-fade-in-up">
          <div>
            <h2 className="section-title">{t("graduationMode.title")}</h2>
            <p className="text-muted-foreground text-sm mt-1">{t("graduationMode.note")}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="persona-graduation-mode">{t("graduationMode.title")}</Label>
            <GraduationModeSelect
              id="persona-graduation-mode"
              ariaLabel={t("graduationMode.title")}
              value={graduationMode}
              allowInherit
              onChange={setGraduationMode}
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {graduationMode === "inherit"
                ? t("graduationMode.globalNote")
                : t(graduationModeNoteKey(graduationMode) as any)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button size="sm" onClick={() => graduationModeMutation.mutate({
              id: personaId,
              graduationMode: graduationMode === "inherit" ? null : graduationMode,
            })}
              disabled={graduationModeMutation.isPending}
              className="rounded-md px-5">
              <Save className="w-3.5 h-3.5" />
              {graduationModeMutation.isPending ? t("common.saving") : t("common.save")}
            </Button>
            {/* In "manual" and "suggest" the user may start the farewell
                whenever they want; in "off" there is nothing to start. */}
            {pendingGraduationMode !== "off"
              && persona.analysisStatus === "ready"
              && persona.graduationStatus !== "graduated" && (
              <Button size="sm" variant="outline"
                onClick={() => graduateMutation.mutate({ id: personaId })}
                disabled={graduateMutation.isPending}
                className="rounded-md px-5">
                {graduateMutation.isPending ? t("graduation.writing") : t("graduationMode.generateLetter")}
              </Button>
            )}
          </div>
          {farewellLetter && (
            <div className="surface p-5">
              <p className="kicker mb-2">{t("graduation.letterKicker", { name: persona.name })}</p>
              <p className="letter-prose text-foreground/90 text-sm whitespace-pre-wrap">{farewellLetter}</p>
            </div>
          )}
        </section>

        {/* Persona Data Editor */}
        {persona.analysisStatus === "ready" && (
          <section className="surface p-5 sm:p-6 space-y-5 animate-fade-in-up">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="section-title">{t("personaEdit.dataTitle")}</h2>
                <p className="text-muted-foreground text-sm mt-1">{t("personaEdit.dataNote")}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowPrompt(!showPrompt)}
                className="text-xs text-muted-foreground rounded-md flex-shrink-0">
                <Eye className="w-3.5 h-3.5" />{showPrompt ? t("personaEdit.hide") : t("personaEdit.preview")} System Prompt
              </Button>
            </div>

            {showPrompt && promptData && (
              <pre className="text-xs text-muted-foreground bg-muted/30 p-4 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap border border-border font-mono leading-relaxed">
                {promptData.prompt}
              </pre>
            )}

            {/* 真人感 — how much the persona writes like a person
                typing, rather than like an assistant answering. It was
                a number in the prompt with no way to reach it. */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {t("personaEdit.realism")} · {realismLevel}
              </Label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={realismLevel}
                onChange={(e) => setRealismLevel(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("personaEdit.realismHint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.personality")}</Label>
              <Textarea value={personality} onChange={e => setPersonality(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.speakingStyle")}</Label>
              <Textarea value={speakingStyle} onChange={e => setSpeakingStyle(e.target.value)} rows={2} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("personaEdit.nickname")}</Label>
                <Input value={nickname} onChange={e => setNickname(e.target.value)}
                  placeholder={t("personaEdit.nicknamePlaceholder")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("personaEdit.attachmentStyle")}</Label>
                <select value={attachmentStyle} onChange={e => setAttachmentStyle(e.target.value)}
                  className={selectClass}>
                  <option value="">{t("personaEdit.notSet")}</option>
                  {ATTACHMENT_STYLES.map(option => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey as any)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.catchphrasesLabel")}</Label>
              <TagInput tags={catchphrases} onChange={setCatchphrases} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("personaEdit.loveLanguage")}</Label>
                <select value={loveLanguage} onChange={e => setLoveLanguage(e.target.value)}
                  className={selectClass}>
                  <option value="">{t("personaEdit.notSet")}</option>
                  {LOVE_LANGUAGES.map(option => (
                    <option key={option.value} value={option.value}>
                      {t(option.labelKey as any)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("personaEdit.conflictStyle")}</Label>
                <Input value={conflictStyle} onChange={e => setConflictStyle(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.memories")}</Label>
              <Textarea value={memories} onChange={e => setMemories(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.touchingMoments")}</Label>
              <Textarea value={touchingMoments} onChange={e => setTouchingMoments(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.starterQuestions")}</Label>
              <TagInput tags={starterQuestions} onChange={setStarterQuestions} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.customInstructions")}</Label>
              <Textarea value={customInstructions} onChange={e => setCustomInstructions(e.target.value)}
                rows={3} placeholder={t("personaEdit.customInstructionsPlaceholder")} />
            </div>
            <Button size="sm" onClick={savePersonaData} disabled={updateDataMutation.isPending}
              className="rounded-md px-5">
              <Save className="w-3.5 h-3.5" />{updateDataMutation.isPending ? t("common.saving") : t("personaEdit.saveData")}
            </Button>
          </section>
        )}

        {/* The rules and the per-state imperfection.

            These two are the parts of a persona that a paragraph cannot
            carry. A rule says what this person discriminates by; the
            imperfection says what their not-being-perfect looks like in
            each mood. Both are optional, and both are off until the user
            turns them on — a persona that was distilled without them
            keeps behaving exactly as it did. */}
        {persona.analysisStatus === "ready" && (
          <section className="surface p-5 sm:p-6 space-y-6 animate-fade-in-up">
            <MicroRulesEditor personaId={personaId} />
            <hr className="rule" />
            <ImperfectionEditor personaId={personaId} />
          </section>
        )}

        {/* Corrections — say what is wrong, in your own words */}
        {persona.analysisStatus === "ready" && (
          <section className="surface p-5 sm:p-6 space-y-5 animate-fade-in-up">
            <div>
              <h2 className="section-title">{t("personaEdit.correctionTitle")}</h2>
              <p className="text-muted-foreground text-sm mt-1">{t("personaEdit.correctionNote")}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("personaEdit.correctionLabel")}</Label>
              <Textarea
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                rows={3}
                placeholder={t("personaEdit.correctionPlaceholder")}
              />
            </div>

            <Button
              size="sm"
              onClick={() => correctionMutation.mutate({ id: personaId, correction })}
              disabled={correctionMutation.isPending || !correction.trim()}
              className="rounded-md px-5"
            >
              <Save className="w-3.5 h-3.5" />
              {correctionMutation.isPending
                ? t("common.saving")
                : t("personaEdit.correctionApply")}
            </Button>

            {Array.isArray(correctionLog) && correctionLog.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("personaEdit.correctionHistory")}</p>
                {correctionLog.map((entry: any, index: number) => (
                  <div key={index} className="text-xs text-muted-foreground border-l-2 border-border pl-3 py-1">
                    {entry?.summary || entry?.correction}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Character card — the persona in a format other tools understand */}
        <section className="surface p-5 sm:p-6 space-y-5 animate-fade-in-up">
          <div>
            <h2 className="section-title">{t("personaCard.title")}</h2>
            <p className="text-muted-foreground text-sm mt-1">{t("personaCard.note")}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              size="sm"
              variant="outline"
              onClick={() => exportCardMutation.mutate({ personaId })}
              disabled={exportCardMutation.isPending || persona.analysisStatus !== "ready"}
              className="rounded-md px-5"
            >
              <Download className="w-3.5 h-3.5" />
              {exportCardMutation.isPending ? t("personaCard.exporting") : t("personaCard.export")}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => cardInputRef.current?.click()}
              disabled={importCardMutation.isPending}
              className="rounded-md px-5"
            >
              <Upload className="w-3.5 h-3.5" />
              {importCardMutation.isPending ? t("personaCard.importing") : t("personaCard.import")}
            </Button>

            <input
              ref={cardInputRef}
              type="file"
              accept="image/png"
              className="hidden"
              aria-label={t("personaCard.pickFile")}
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) handleCardFile(file);
              }}
            />
          </div>
        </section>

        {persona.analysisStatus !== "ready" && (
          <div className="surface p-6 sm:p-8 text-center animate-fade-in-up">
            <p className="kicker kicker-accent mb-3">{t("personaEdit.almostThere")}</p>
            <p className="font-sans text-base font-semibold text-foreground mb-2">{t("personaEdit.notReadyTitle")}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">{t("personaEdit.notReadyBody")}</p>
            <hr className="rule w-16 mx-auto my-6" />
            <Button size="sm" onClick={() => navigate(`/upload/${personaId}`)}>{t("personaEdit.goUpload")}</Button>
          </div>
        )}
      </main>
    </div>
  );
}
