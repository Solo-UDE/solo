import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

/**
 * Skeleton — loading placeholder.
 *
 * Variants:
 *   pulse   — opacity oscillation (default, cheapest).
 *   shimmer — gradient sweep using OKLCH relative color so the highlight
 *             is always ~6% lighter than --muted in any theme.
 */
export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "pulse" | "shimmer";
  /** @deprecated use `variant="shimmer"` */
  shimmer?: boolean;
}

export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant, shimmer, ...props }, ref) => {
    const mode = variant ?? (shimmer ? "shimmer" : "pulse");
    if (mode === "shimmer") {
      return (
        <div
          ref={ref}
          className={cn("rounded-md bg-muted relative overflow-hidden", className)}
          {...props}
        >
          <div
            className="absolute inset-0 animate-[loading-shimmer_1.4s_infinite_cubic-bezier(0.4,0,0.2,1)]"
            style={{
              backgroundImage:
                "linear-gradient(100deg, transparent 30%, oklch(from var(--muted) calc(l + 0.06) c h / 60%) 50%, transparent 70%)",
              backgroundSize: "200% 100%",
            }}
          />
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn("animate-pulse rounded-md bg-muted", className)}
        aria-hidden="true"
        {...props}
      />
    );
  },
);

Skeleton.displayName = "Skeleton";
