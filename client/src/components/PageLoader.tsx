/** 页面级加载占位（路由分包后的 Suspense fallback） */
import { useLocale } from "@/contexts/LocaleContext";

export default function PageLoader() {
  const { t } = useLocale();
  return (
    // The loader is announced. It used to be a pulsing dot with no
    // text and no role, so a screen reader said nothing at all while
    // the page was loading.
    <div className="min-h-dvh bg-background flex items-center justify-center" role="status" aria-live="polite">
      <span className="seal-dot animate-pulse-soft" />
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
