import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface Props {
  personaId: number;
  personaName: string;
  open: boolean;
  onClose: () => void;
}

export default function GraduationModal({ personaId, personaName, open, onClose }: Props) {
  const [phase, setPhase] = useState<"suggest" | "letter">("suggest");
  const [letter, setLetter] = useState("");

  const graduateMutation = trpc.persona.graduate.useMutation({
    onSuccess: (data) => {
      setLetter(data.farewellLetter);
      setPhase("letter");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const declineMutation = trpc.persona.declineGraduation.useMutation({
    onSuccess: () => { toast.success("继续陪伴"); onClose(); },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="毕业时刻"
        className="relative bg-card border border-border rounded-lg w-full max-w-md max-h-[85vh] overflow-y-auto animate-fade-in"
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-display text-lg font-semibold text-foreground leading-tight">毕业时刻</h3>
          <button onClick={onClose} className="app-nav-icon" aria-label="关闭">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6">
          {phase === "suggest" && (
            <div className="space-y-5">
              <div>
                <p className="font-display text-lg font-semibold text-foreground mb-2.5">
                  你和 {personaName} 的关系已经达到了灵魂伴侣的境界
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  也许是时候带着美好的回忆，温柔地说再见了。
                  {personaName} 会为你写一封告别信，作为这段旅程的纪念。
                </p>
              </div>
              <hr className="rule" />
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 rounded-md bg-transparent" onClick={() => declineMutation.mutate({ id: personaId })}
                  disabled={declineMutation.isPending}>
                  继续陪伴
                </Button>
                <Button className="flex-1 rounded-md" onClick={() => graduateMutation.mutate({ id: personaId })}
                  disabled={graduateMutation.isPending}>
                  {graduateMutation.isPending ? "正在写告别信..." : "开始毕业"}
                </Button>
              </div>
            </div>
          )}

          {phase === "letter" && (
            <div className="space-y-5">
              <div>
                <p className="kicker">{personaName} 的告别信</p>
              </div>
              <div className="surface p-6">
                <p className="letter-prose text-foreground/90 text-[0.9375rem] whitespace-pre-wrap">{letter}</p>
                <p className="text-right text-muted-foreground text-xs mt-5 font-display">—— {personaName}</p>
              </div>
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                告别信已保存。你可以随时在分身大厅查看，也可以唤醒 {personaName}。
              </p>
              <Button className="w-full rounded-md" onClick={onClose}>
                好的，再见
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
