import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft, Loader2, ChevronRight, Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import DistillationModePicker from "@/components/DistillationModePicker";
import { resolveIntakeGaps } from "@/lib/intake-gaps";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import {
  DEFAULT_DISTILLATION_MODE,
  type DistillationMode,
} from "@shared/distillation-modes";

const ALL_ACCEPT = ".txt,.csv,image/*,video/*";

/** The agent hosts a generated skill package can be installed into. */
const SKILL_HOSTS = ["claude-code", "openclaw", "codex", "hermes"] as const;

/**
 * What the research audit could not find.
 *
 * The celebrity research flow grades its own evidence. When the material is
 * thin, the audit records the gaps — missing sources, unresolved
 * contradictions — and the persona is built from what there is. Showing
 * those gaps is the difference between "the model was wrong" and "you did
 * not give it enough to work with".
 */
function ResearchGaps({ personaId }: { personaId: number }) {
  const { t } = useLocale();
  const { data: profile } = trpc.skillEngine.getResearchProfile.useQuery(
    { personaId },
    { enabled: personaId > 0 },
  );

  if (!profile) return null;

  const audit = (profile.audit ?? {}) as any;
  const gaps: string[] = Array.isArray(audit.evidence_gaps) ? audit.evidence_gaps : [];
  const contradictions: string[] = Array.isArray(audit.unresolved_contradictions)
    ? audit.unresolved_contradictions
    : [];

  if (gaps.length === 0 && contradictions.length === 0) return null;

  return (
    <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up">
      <p className="text-sm text-foreground mb-2">{t("research.gapsTitle")}</p>
      {gaps.length > 0 && (
        <div className="mb-2">
          <p className="text-xs text-muted-foreground mb-1">
            {t("research.missingSources", { count: gaps.length })}
          </p>
          <ul className="space-y-1">
            {gaps.map((gap, i) => (
              <li key={i} className="text-xs text-muted-foreground leading-relaxed">· {gap}</li>
            ))}
          </ul>
        </div>
      )}
      {contradictions.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">
            {t("research.contradictions", { count: contradictions.length })}
          </p>
          <ul className="space-y-1">
            {contradictions.map((item, i) => (
              <li key={i} className="text-xs text-muted-foreground leading-relaxed">· {item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * What the intake stage said is missing.
 *
 * The distillation pipeline starts by taking stock of the material and
 * naming the gaps — the chats, the photos, the details it would need to
 * do a better job. That answer is stored on the job, so it can be shown
 * here: the user learns what to upload next instead of wondering why the
 * persona came out thin.
 */
function IntakeGaps({ inputMeta }: { inputMeta: unknown }) {
  const { t } = useLocale();
  const gaps = resolveIntakeGaps(inputMeta);
  if (!gaps) return null;

  return (
    <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up">
      <p className="text-sm text-foreground mb-1">{t("upload.gapsTitle")}</p>
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{t("upload.gapsNote")}</p>
      <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed border-l-2 border-border pl-3 py-1">
        {gaps}
      </p>
    </div>
  );
}

function detectFileType(file: File): "chat_txt" | "chat_csv" | "image" | "video" {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "txt") return "chat_txt";
  if (ext === "csv") return "chat_csv";
  if (file.type.startsWith("video/")) return "video";
  return "image";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getMimeType(file: File, fileType: string): string {
  if (fileType === "chat_txt") return "text/plain";
  if (fileType === "chat_csv") return "text/csv";
  return file.type || "application/octet-stream";
}

export default function Upload() {
  const params = useParams<{ id: string }>();
  const personaId = parseInt(params.id || "0");
  const [, navigate] = useLocation();
  const { isAuthenticated } = useAuth();
  const { t } = useLocale();

  const [uploadingFiles, setUploadingFiles] = useState<Record<string, "uploading" | "done" | "error">>({});
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /* The distillation preset this run uses. It is remembered on the
     persona, so a re-run keeps the same choice. */
  const [mode, setMode] = useState<DistillationMode>(DEFAULT_DISTILLATION_MODE);

  const { data: persona, refetch: refetchPersona } = trpc.persona.get.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const { data: files, refetch: refetchFiles } = trpc.file.list.useQuery(
    { personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  // Material pulled in by a collector is just as usable as an uploaded file.
  // A persona whose only material came from a collector must still be
  // distillable from here.
  const { data: collected } = trpc.collector.preview.useQuery(
    { personaId, limit: 1 },
    { enabled: isAuthenticated && personaId > 0 },
  );
  const { data: analysisStatus, refetch: refetchStatus } = trpc.persona.getAnalysisStatus.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && personaId > 0,
      refetchInterval: (query) => query.state.data?.status === "analyzing" ? 1500 : false }
  );

  // The persona carries the id of the distillation job, which knows the real
  // pipeline stage — "正在分析人物性格" is a summary, the job knows whether it
  // is researching, auditing or building.
  const jobId = persona?.skillJobId ?? null;
  const { data: jobStatus } = trpc.skillEngine.getJobStatus.useQuery(
    { jobId: jobId ?? 0 },
    {
      enabled: isAuthenticated && jobId !== null,
      refetchInterval: (query) => {
        const stage = query.state.data?.pipelineStage;
        return stage === "complete" || stage === "error" ? false : 1500;
      },
    }
  );

  /* The skill package the distillation run produced can be installed into
     the supported agent hosts. */
  const exportSkillMutation = trpc.skillEngine.exportSkill.useMutation({
    onSuccess: (result: any) => {
      toast.success(t("skillExport.exported", { path: result?.installPath ?? "" }));
    },
    onError: (e: any) => toast.error(t("skillExport.failed", { message: e.message })),
  });

  useEffect(() => {
    if (analysisStatus?.status === "ready") refetchPersona();
  }, [analysisStatus?.status]);

  // The persona remembers the preset it was built with, so the picker starts
  // from the last choice rather than from the default.
  useEffect(() => {
    const saved = (persona as any)?.distillationMode;
    if (saved) setMode(saved as DistillationMode);
  }, [persona?.distillationMode]);

  const uploadMutation = trpc.file.upload.useMutation({
    onError: (e) => toast.error(t("upload.uploadError", { message: e.message })),
  });
  const triggerMutation = trpc.persona.triggerAnalysis.useMutation({
    onSuccess: () => { toast.success(t("upload.analysisStarted")); refetchStatus(); },
    onError: (e) => toast.error(t("upload.analysisFailed", { message: e.message })),
  });
  /* The preset is remembered on the persona, so a re-run of the
     distillation keeps the same choice. */
  const saveModeMutation = trpc.persona.update.useMutation({
    onError: (e: any) => toast.error(e.message),
  });

  const handleFiles = useCallback(async (fileList: FileList) => {
    for (const file of Array.from(fileList)) {
      const key = `${file.name}-${Date.now()}`;
      const fileType = detectFileType(file);
      setUploadingFiles(prev => ({ ...prev, [key]: "uploading" }));
      try {
        const content = await fileToBase64(file);
        await uploadMutation.mutateAsync({
          personaId, fileName: file.name, fileType,
          fileSize: file.size, fileContent: content, mimeType: getMimeType(file, fileType),
        });
        setUploadingFiles(prev => ({ ...prev, [key]: "done" }));
        toast.success(t("upload.uploadSuccess", { name: file.name }));
        refetchFiles();
      } catch {
        setUploadingFiles(prev => ({ ...prev, [key]: "error" }));
      }
    }
  }, [personaId, uploadMutation, refetchFiles, t]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const isAnalyzing = analysisStatus?.status === "analyzing";
  const isReady = analysisStatus?.status === "ready";
  const hasFiles = (files?.length || 0) > 0;
  const hasCollected = (collected?.total || 0) > 0;
  const hasMaterial = hasFiles || hasCollected;
  const filesLoading = isAuthenticated && personaId > 0 && files === undefined;
  const pendingUploads = Object.entries(uploadingFiles).filter(([, s]) => s !== "done");

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
              <p className="kicker">{t("upload.materials")}</p>
              <p className="app-nav-title">{persona?.name || "..."}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container page-main max-w-3xl">
        {/* Page Intro */}
        <div className="mb-8 animate-fade-in-up">
          <p className="kicker kicker-accent mb-3">{t("upload.kicker")}</p>
          <h1 className="page-title">{t("upload.materials")}</h1>
          <p className="text-muted-foreground text-sm mt-2.5 leading-relaxed">
            {t("upload.intro")}
          </p>
          <hr className="rule w-16 mt-6" />
        </div>

        {/* Analysis Status · Ready */}
        {isReady && (
          <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
              <div>
                <p className="font-sans text-base font-semibold text-foreground">{t("upload.ready")}</p>
                <p className="text-muted-foreground text-sm mt-1">
                  {jobStatus?.stageMessage || analysisStatus?.message}
                </p>
              </div>
              <Button onClick={() => navigate(`/chat/${personaId}`)}
                className="rounded-md px-6 self-start sm:self-auto">
                {t("upload.startChat")} <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
            {/* The distillation run also produces a skill package, which can
                be installed into the supported agent hosts. */}
            {jobId && jobStatus?.generatedSkillPath && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2">{t("skillExport.title")}</p>
                <div className="flex flex-wrap gap-2">
                  {SKILL_HOSTS.map((host) => (
                    <Button
                      key={host}
                      size="sm"
                      variant="outline"
                      disabled={exportSkillMutation.isPending}
                      onClick={() => exportSkillMutation.mutate({ jobId, host })}
                      className="rounded-md text-xs"
                    >
                      {t(`skillExport.hosts.${host}`)}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Analysis Status · Analyzing */}
        {isAnalyzing && (
          <div className="surface p-6 sm:p-8 mb-6 animate-fade-in-up">
            <div className="flex items-center gap-2.5 mb-6">
              <Loader2 className="w-3.5 h-3.5 text-cinnabar animate-spin" />
              <p className="kicker kicker-accent">{t("upload.analyzingKicker")}</p>
            </div>
            <div className="flex items-end justify-between gap-4 mb-4">
              <div className="font-display text-5xl sm:text-6xl font-semibold text-foreground leading-none">
                {analysisStatus?.progress || 0}<span className="text-2xl sm:text-3xl">%</span>
              </div>
              <p className="text-sm text-muted-foreground text-right pb-1">{t("upload.analyzingNow")}</p>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-3.5">
              <div className="progress-bar h-full" style={{ width: `${analysisStatus?.progress || 0}%` }} />
            </div>
            {analysisStatus?.message ? (
              <p className="text-muted-foreground text-sm leading-relaxed">{analysisStatus.message}</p>
            ) : (
              <div className="shimmer h-3.5 w-2/3 rounded-full" />
            )}
          </div>
        )}

        {/* Analysis Status · Error */}
        {!isReady && !isAnalyzing && analysisStatus?.status === "error" && (
          <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up">
            <p className="text-sm text-destructive leading-relaxed">
              {analysisStatus?.message || t("upload.failedRetry")}
            </p>
          </div>
        )}

        {/* Research gaps. The audit stage records what it could not find, so
            the user learns what is missing instead of seeing a bare
            failure. */}
        <ResearchGaps personaId={personaId} />

        {/* What the intake stage found missing from the material. It stays
            visible after the run, because the natural next step is to
            upload more and run it again. */}
        <IntakeGaps inputMeta={jobStatus?.inputMeta} />

        {/* Drop Zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label={t("upload.dropLabel")}
          className={`rounded-lg border border-dashed p-10 sm:p-14 mb-6 text-center cursor-pointer transition-colors animate-fade-in-up outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
            dragOver
              ? "border-foreground/50 bg-muted/40"
              : "border-border bg-card hover:border-foreground/30"
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault(); fileInputRef.current?.click();
            }
          }}
        >
          <p className="font-display text-lg sm:text-xl font-semibold text-foreground mb-2">
            {t("upload.dropTitle")}
          </p>
          <p className="text-muted-foreground text-sm">{t("upload.formatsHint")}</p>
          <input ref={fileInputRef} type="file" accept={ALL_ACCEPT}
            multiple className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
        </div>

        {/* No chat logs? The questionnaire builds a persona without them. */}
        <div className="text-center mb-6 animate-fade-in-up">
          <button
            onClick={() => navigate("/persona/new/questionnaire")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
          >
            {t("upload.noChatLogs")}
          </button>
        </div>

        {/* Uploaded Files */}
        {(hasFiles || pendingUploads.length > 0 || filesLoading) && (
          <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="font-display text-base font-semibold text-foreground">{t("upload.uploadedFiles")}</h2>
              <span className="kicker">{t("upload.fileCount", { count: files?.length ?? 0 })}</span>
            </div>
            <div>
              {files?.map((f: any) => (
                <div key={f.id} className="flex items-center gap-3 py-3 border-t border-border">
                  <span className="text-sm text-foreground/85 flex-1 truncate">{f.originalName}</span>
                  <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
                    {(f.fileSize / 1024).toFixed(0)} KB
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                    <Check className="w-3 h-3" />{t("upload.uploaded")}
                  </span>
                </div>
              ))}
              {pendingUploads.map(([key, status]) => (
                <div key={key} className="flex items-center gap-3 py-3 border-t border-border">
                  <span className="text-sm text-muted-foreground flex-1 truncate">
                    {key.replace(/-\d+$/, "")}
                  </span>
                  {status === "uploading" ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
                      <Loader2 className="w-3 h-3 animate-spin" />{t("upload.uploading")}
                    </span>
                  ) : (
                    <span className="text-xs text-destructive flex-shrink-0">{t("upload.uploadFailed")}</span>
                  )}
                </div>
              ))}
              {filesLoading && [0, 1].map(i => (
                <div key={`skeleton-${i}`} className="flex items-center gap-3 py-3 border-t border-border">
                  <div className="shimmer h-3.5 flex-1 rounded-full" />
                  <div className="shimmer h-3.5 w-16 rounded-full flex-shrink-0" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trigger Analysis */}
        {hasMaterial && !isAnalyzing && !isReady && (
          <>
            <div className="surface p-5 sm:p-6 mb-4 animate-fade-in-up">
              <div className="mb-3">
                <p className="font-display text-base font-semibold text-foreground">{t("distillation.title")}</p>
                <p className="text-muted-foreground text-sm mt-1 leading-relaxed">{t("distillation.note")}</p>
              </div>
              <DistillationModePicker
                value={mode}
                onChange={next => {
                  setMode(next);
                  saveModeMutation.mutate({ id: personaId, distillationMode: next });
                }}
                disabled={triggerMutation.isPending}
              />
            </div>
            <Button className="w-full h-12 rounded-md text-base font-semibold animate-fade-in-up"
              onClick={() => triggerMutation.mutate({ id: personaId, mode })}
              disabled={triggerMutation.isPending}>
              {triggerMutation.isPending
                ? <><Loader2 className="w-5 h-5 animate-spin" />{t("upload.starting")}</>
                : <>{t("upload.startAnalysis")}</>}
            </Button>
          </>
        )}

        {/* Tips */}
        <div className="surface p-5 sm:p-6 mt-6 animate-fade-in-up">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-foreground">{t("upload.tipsTitle")}</h2>
            <span className="kicker">{t("upload.tipsKicker")}</span>
          </div>
          <ul className="space-y-2.5">
            {Array.from(t("upload.tips")).map((tip, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground leading-relaxed">
                <span className="w-1 h-1 bg-foreground/30 mt-[0.55rem] flex-shrink-0" />
                {tip}
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
