import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  ArrowLeft, Upload as UploadIcon, FileText, Image as ImageIcon, Video as VideoIcon,
  CheckCircle2, Loader2, Sparkles, AlertCircle, ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const FILE_TYPE_ICONS: Record<string, any> = {
  chat_txt: FileText, chat_csv: FileText, image: ImageIcon, video: VideoIcon,
};

const ALL_ACCEPT = ".txt,.csv,image/*,video/*";

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
              <p className="app-nav-title">{persona?.name || "..."}</p>
              <p className="app-nav-subtitle">上传资料</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-8 max-w-2xl mx-auto">
        {/* Analysis Status */}
        {isReady ? (
          <div className="warm-card p-5 mb-6 flex items-center justify-between animate-fade-in-up">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <div>
                <p className="text-foreground font-medium">数字分身已准备好</p>
                <p className="text-muted-foreground text-sm">{analysisStatus?.message}</p>
              </div>
            </div>
            <Button onClick={() => navigate(`/chat/${personaId}`)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl">
              开始对话 <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        ) : isAnalyzing ? (
          <div className="warm-card p-5 mb-6 animate-fade-in-up">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
              <p className="text-foreground font-medium">AI 正在解析中...</p>
            </div>
            <p className="text-muted-foreground text-sm mb-3">{analysisStatus?.message}</p>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="progress-bar h-full" style={{ width: `${analysisStatus?.progress || 0}%` }} />
            </div>
            <p className="text-right text-xs text-muted-foreground mt-1">{analysisStatus?.progress || 0}%</p>
          </div>
        ) : analysisStatus?.status === "error" ? (
          <div className="warm-card p-5 mb-6 border-destructive/20 animate-fade-in-up">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-destructive" />
              <p className="text-muted-foreground text-sm">{analysisStatus?.message || "解析失败，请重试"}</p>
            </div>
          </div>
        ) : null}

        {/* Drop Zone */}
        <div
          className={`warm-card p-8 mb-5 text-center border-2 border-dashed transition-all cursor-pointer animate-fade-in-up ${
            dragOver ? "border-primary/60 bg-primary/5" : "border-border hover:border-primary/30"
          }`}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon className={`w-10 h-10 mx-auto mb-3 transition-colors ${dragOver ? "text-primary" : "text-muted-foreground/30"}`} />
          <p className="text-foreground/70 font-medium mb-1">拖拽文件到这里，或点击选择</p>
          <p className="text-muted-foreground text-sm">支持 .txt、.csv、图片、视频</p>
          <input ref={fileInputRef} type="file" accept={ALL_ACCEPT}
            multiple className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
        </div>

        {/* Uploaded Files */}
        {hasFiles && (
          <div className="warm-card p-5 mb-5 animate-fade-in-up">
            <p className="text-foreground/70 text-sm font-medium mb-3">已上传文件 ({files?.length})</p>
            <div className="space-y-2">
              {files?.map((f: any) => {
                const Icon = FILE_TYPE_ICONS[f.fileType] || FileText;
                return (
                  <div key={f.id} className="flex items-center gap-3 py-2 px-3 bg-muted/30 rounded-lg">
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm text-foreground/70 flex-1 truncate">{f.originalName}</span>
                    <span className="text-xs text-muted-foreground">{(f.fileSize / 1024).toFixed(0)} KB</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Uploading */}
        {Object.entries(uploadingFiles).some(([, s]) => s === "uploading") && (
          <div className="warm-card p-4 mb-5 animate-fade-in">
            <div className="flex items-center gap-2 text-primary text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />正在上传...
            </div>
          </div>
        )}

        {/* Trigger Analysis */}
        {hasFiles && !isAnalyzing && !isReady && (
          <Button className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground text-base font-semibold rounded-xl animate-fade-in-up"
            onClick={() => triggerMutation.mutate({ id: personaId })} disabled={triggerMutation.isPending}>
            {triggerMutation.isPending
              ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" />启动中...</>
              : <><Sparkles className="w-5 h-5 mr-2" />开始 AI 解析，生成数字分身</>}
          </Button>
        )}

        {/* Tips */}
        <div className="mt-6 p-4 bg-muted/30 rounded-xl border border-border animate-fade-in-up">
          <p className="text-foreground/50 text-xs font-medium mb-2">上传建议</p>
          <ul className="text-muted-foreground text-xs space-y-1 leading-relaxed">
            <li>· 微信聊天记录：在微信 → 聊天详情 → 导出聊天记录 → 保存为 txt</li>
            <li>· 聊天记录越多，AI 分析越准确（建议至少 100 条消息）</li>
            <li>· 可以同时上传多种类型的文件，AI 会综合分析</li>
            <li>· 所有文件仅用于构建分身，不会被分享给任何第三方</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
