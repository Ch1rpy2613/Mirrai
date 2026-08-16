import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-dvh p-8 bg-background">
          <div className="w-full max-w-2xl animate-fade-in">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold text-foreground mb-3">出了点问题</h2>
            <p className="text-sm text-muted-foreground mb-8">页面遇到了意外错误，刷新一次通常就能恢复。</p>

            <div className="p-4 w-full rounded-lg bg-muted/60 border border-border overflow-auto mb-8 max-h-56">
              <pre className="text-xs font-mono text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-6 h-10 rounded-md text-sm font-medium",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 transition-opacity cursor-pointer"
              )}
            >
              <RotateCcw size={15} />
              重新加载
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
