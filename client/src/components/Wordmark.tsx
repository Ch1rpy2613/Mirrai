import { cn } from "@/lib/utils";

export function Wordmark({
  size = "text-base",
  className,
}: {
  size?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-1.5 font-display font-semibold text-foreground", size, className)}>
      Mirrai
      <span className="seal-dot translate-y-[-1px]" aria-hidden />
    </span>
  );
}
