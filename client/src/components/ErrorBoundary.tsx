import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";
import { translate, type Locale } from "@/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * The locale the provider persisted.
 *
 * The error boundary sits *above* the locale provider, so it cannot read the
 * locale from context — it reads the very same storage key the provider
 * writes.
 */
function currentLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  try {
    // The storage can refuse: private mode, cookies disabled, a full
    // quota. And this is read *during* the render of the error
    // boundary — so a throw here happened inside the recovery screen and
    // the app was left blank, with no way back.
    return (window.localStorage.getItem("mirrai-locale") as Locale) || "zh";
  } catch {
    return "zh";
  }
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
      const locale = currentLocale();

      return (
        <div className="flex items-center justify-center min-h-dvh p-8 bg-background">
          <div className="w-full max-w-2xl animate-fade-in">
            <h2 className="page-title mb-3">{translate(locale, "errors.boundaryTitle")}</h2>
            <p className="text-sm text-muted-foreground mb-8">
              {translate(locale, "errors.boundaryBodyLong")}
            </p>

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
              {translate(locale, "errors.reload")}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
