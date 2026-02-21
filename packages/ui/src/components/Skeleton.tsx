import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Use shimmer gradient instead of pulse */
  shimmer?: boolean;
}

/**
 * Skeleton placeholder following Solo/Orbit design system
 *
 * - Default: subtle pulse animation (bg-muted opacity oscillation)
 * - shimmer: synchronized gradient sweep using OKLCH relative color
 *   so highlight is always perceptually 6% lighter than --muted in any theme
 */
export const Skeleton = forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, shimmer, ...props }, ref) => {
    if (shimmer) {
      return (
        <div
          ref={ref}
          className={cn("rounded-md bg-muted relative overflow-hidden", className)}
          {...props}
        >
          <div
            className="absolute inset-0 animate-[shimmer_2s_infinite_linear]"
            style={{
              backgroundImage: `linear-gradient(
                100deg,
                transparent 30%,
                oklch(from var(--muted) calc(l + 0.06) c h / 60%) 50%,
                transparent 70%
              )`,
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
        {...props}
      />
    );
  }
);

Skeleton.displayName = "Skeleton";
