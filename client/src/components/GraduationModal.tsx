import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { X, GraduationCap, Heart, Sunrise } from "lucide-react";
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
      <div className="relative bg-card border border-border rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto animate-fade-in">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-primary" />
            <h3 className="font-medium text-foreground">毕业时刻</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {phase === "suggest" && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                <Sunrise className="w-8 h-8 text-primary" />
              </div>
              <div>
                <p className="text-foreground font-medium mb-2">
                  你和 {personaName} 的关系已经达到了灵魂伴侣的境界
                </p>
                <p className="text-sm text-muted-foreground">
                  也许是时候带着美好的回忆，温柔地说再见了。
                  {personaName} 会为你写一封告别信，作为这段旅程的纪念。
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => declineMutation.mutate({ id: personaId })}
                  disabled={declineMutation.isPending}>
                  <Heart className="w-4 h-4 mr-1.5" />继续陪伴
                </Button>
                <Button className="flex-1" onClick={() => graduateMutation.mutate({ id: personaId })}
                  disabled={graduateMutation.isPending}>
                  {graduateMutation.isPending ? "正在写告别信..." : "开始毕业"}
                </Button>
              </div>
            </div>
          )}

          {phase === "letter" && (
            <div className="space-y-4">
              <div className="text-center mb-2">
                <p className="text-sm text-muted-foreground">{personaName} 的告别信</p>
              </div>
              <div className="bg-muted/30 border border-border rounded-xl p-5">
                <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">{letter}</p>
                <p className="text-right text-muted-foreground text-xs mt-4">—— {personaName}</p>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                告别信已保存。你可以随时在分身大厅查看，也可以唤醒 {personaName}。
              </p>
              <Button className="w-full" onClick={onClose}>
                好的，再见
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
