import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Wordmark";
import { Home } from "lucide-react";
import { useLocation } from "wouter";
import { useLocale } from "@/contexts/LocaleContext";

export default function NotFound() {
  const [, setLocation] = useLocation();
  const { t } = useLocale();

  return (
    <main className="min-h-dvh w-full flex items-center justify-center bg-background px-4">
      <div className="max-w-md animate-fade-in-up">
        <div className="mb-8">
          <Wordmark />
        </div>
        <div className="font-display text-7xl font-semibold text-foreground mb-6">
          404<span className="text-cinnabar">.</span>
        </div>

        {/**
         * The heading of the page.
         *
         * It was an `h2`, and there was no `main` around it — so the
         * focus could never move onto this page. A keyboard user who
         * followed a link to a page that is not there stayed focused
         * on the link they came from, and a screen reader read out
         * the page before, with nothing to say that the page had
         * changed.
         *
         * The heading is the first thing on the page and it says what
         * the page is, so it is what the focus should land on.
         */}
        <h1 className="page-title mb-3">
          {t("errors.notFoundHeading")}
        </h1>

        <p className="text-muted-foreground mb-8 leading-relaxed text-[0.9375rem]">
          {t("errors.notFoundBodyLine1")}
          <br />
          {t("errors.notFoundBodyLine2")}
        </p>

        <hr className="rule w-16 mb-8" />

        <Button onClick={() => setLocation("/")} className="rounded-md px-8 h-11 gap-2">
          <Home className="w-4 h-4" />
          {t("errors.backHome")}
        </Button>
      </div>
    </main>
  );
}
