import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft, Loader2, ChevronRight, Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const ALL_ACCEPT = ".txt,.csv,image/*,video/*";

const TIPS = [
  "微信聊天记录：在微信 → 聊天详情 → 导出聊天记录 → 保存为 txt",
  "聊天记录越多，AI 分析越准确（建议至少 100 条消息）",
  "可以同时上传多种类型的文件，AI 会综合分析",
  "所有文件仅用于构建分身，不会被分享给任何第三方",
];

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

  const [uploadingFiles, setUploadingFiles] = useState<Record<string, "uploading" | "done" | "error">>({});
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: persona, refetch: refetchPersona } = trpc.persona.get.useQuery(
    { id: personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const { data: files, refetch: refetchFiles } = trpc.file.list.useQuery(
    { personaId }, { enabled: isAuthenticated && personaId > 0 }
  );
  const { data: analysisStatus, refetch: refetchStatus } = trpc.persona.getAnalysisStatus.useQuery(
    { id: personaId },
    { enabled: isAuthenticated && personaId > 0,
      refetchInterval: (query) => query.state.data?.status === "analyzing" ? 1500 : false }
  );

  useEffect(() => {
    if (analysisStatus?.status === "ready") refetchPersona();
  }, [analysisStatus?.status]);

  const uploadMutation = trpc.file.upload.useMutation({
    onError: (e) => toast.error("上传失败：" + e.message),
  });
  const triggerMutation = trpc.persona.triggerAnalysis.useMutation({
    onSuccess: () => { toast.success("AI 解析已开始"); refetchStatus(); },
    onError: (e) => toast.error("解析失败：" + e.message),
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
        toast.success(`${file.name} 上传成功`);
        refetchFiles();
      } catch {
        setUploadingFiles(prev => ({ ...prev, [key]: "error" }));
      }
    }
  }, [personaId, uploadMutation, refetchFiles]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const isAnalyzing = analysisStatus?.status === "analyzing";
  const isReady = analysisStatus?.status === "ready";
  const hasFiles = (files?.length || 0) > 0;
  const filesLoading = isAuthenticated && personaId > 0 && files === undefined;
  const pendingUploads = Object.entries(uploadingFiles).filter(([, s]) => s !== "done");

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")}
            className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">返回</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-title-group">
            <div>
              <p className="kicker">上传资料</p>
              <p className="app-nav-title">{persona?.name || "..."}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container page-main max-w-2xl">
        {/* Page Intro */}
        <div className="mb-8 animate-fade-in-up">
          <p className="kicker kicker-accent mb-3">信物</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-foreground">上传资料</h1>
          <p className="text-muted-foreground text-sm mt-2.5 leading-relaxed">
            聊天记录、照片与片段——这些信物会成为分身认识你的方式。
          </p>
          <hr className="rule w-16 mt-6" />
        </div>

        {/* Analysis Status · Ready */}
        {isReady && (
          <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
              <div>
                <p className="font-display text-lg font-semibold text-foreground">数字分身已准备好</p>
                <p className="text-muted-foreground text-sm mt-1">{analysisStatus?.message}</p>
              </div>
              <Button onClick={() => navigate(`/chat/${personaId}`)}
                className="rounded-md px-6 self-start sm:self-auto">
                开始对话 <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Analysis Status · Analyzing */}
        {isAnalyzing && (
          <div className="surface p-6 sm:p-8 mb-6 animate-fade-in-up">
            <div className="flex items-center gap-2.5 mb-6">
              <Loader2 className="w-3.5 h-3.5 text-cinnabar animate-spin" />
              <p className="kicker kicker-accent">解析中</p>
            </div>
            <div className="flex items-end justify-between gap-4 mb-4">
              <div className="font-display text-5xl sm:text-6xl font-semibold text-foreground leading-none">
                {analysisStatus?.progress || 0}<span className="text-2xl sm:text-3xl">%</span>
              </div>
              <p className="text-sm text-muted-foreground text-right pb-1">AI 正在解析中...</p>
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
              {analysisStatus?.message || "解析失败，请重试"}
            </p>
          </div>
        )}

        {/* Drop Zone */}
        <div
          role="button"
          tabIndex={0}
          aria-label="上传文件：拖拽文件到这里，或按回车选择文件"
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
            拖拽文件到这里，或点击选择
          </p>
          <p className="text-muted-foreground text-sm">支持 .txt、.csv、图片、视频</p>
          <input ref={fileInputRef} type="file" accept={ALL_ACCEPT}
            multiple className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
        </div>

        {/* Uploaded Files */}
        {(hasFiles || pendingUploads.length > 0 || filesLoading) && (
          <div className="surface p-5 sm:p-6 mb-6 animate-fade-in-up">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="font-display text-base font-semibold text-foreground">已上传文件</h2>
              <span className="kicker">{files?.length ?? 0} 个文件</span>
            </div>
            <div>
              {files?.map((f: any) => (
                <div key={f.id} className="flex items-center gap-3 py-3 border-t border-border">
                  <span className="text-sm text-foreground/85 flex-1 truncate">{f.originalName}</span>
                  <span className="text-xs text-muted-foreground font-mono flex-shrink-0">
                    {(f.fileSize / 1024).toFixed(0)} KB
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                    <Check className="w-3 h-3" />已上传
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
                      <Loader2 className="w-3 h-3 animate-spin" />上传中
                    </span>
                  ) : (
                    <span className="text-xs text-destructive flex-shrink-0">上传失败</span>
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
        {hasFiles && !isAnalyzing && !isReady && (
          <Button className="w-full h-12 rounded-md text-base font-semibold animate-fade-in-up"
            onClick={() => triggerMutation.mutate({ id: personaId })} disabled={triggerMutation.isPending}>
            {triggerMutation.isPending
              ? <><Loader2 className="w-5 h-5 animate-spin" />启动中...</>
              : <>开始 AI 解析，生成数字分身</>}
          </Button>
        )}

        {/* Tips */}
        <div className="surface p-5 sm:p-6 mt-6 animate-fade-in-up">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-base font-semibold text-foreground">上传建议</h2>
            <span className="kicker">提示</span>
          </div>
          <ul className="space-y-2.5">
            {TIPS.map(tip => (
              <li key={tip} className="flex items-start gap-2.5 text-sm text-muted-foreground leading-relaxed">
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
