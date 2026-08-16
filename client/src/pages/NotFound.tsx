import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Wordmark";
import { Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-dvh w-full flex items-center justify-center bg-background px-4">
      <div className="max-w-md animate-fade-in-up">
        <div className="mb-8">
          <Wordmark />
        </div>
        <div className="font-display text-7xl font-semibold text-foreground mb-6">
          404<span className="text-cinnabar">.</span>
        </div>

        <h2 className="font-display text-xl font-semibold text-foreground mb-3">
          这一页，不在这里
        </h2>

        <p className="text-muted-foreground mb-8 leading-relaxed text-[0.9375rem]">
          你要找的页面或许被挪走了，或许从未存在。
          <br />
          但灯火还在，回去的路也还在。
        </p>

        <hr className="rule w-16 mb-8" />

        <Button onClick={() => setLocation("/")} className="rounded-md px-8 h-11 gap-2">
          <Home className="w-4 h-4" />
          回到大厅
        </Button>
      </div>
    </div>
  );
}
