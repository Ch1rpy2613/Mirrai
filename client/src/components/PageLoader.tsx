/** 页面级加载占位（路由分包后的 Suspense fallback） */
export default function PageLoader() {
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center">
      <span className="seal-dot animate-pulse-soft" />
    </div>
  );
}
