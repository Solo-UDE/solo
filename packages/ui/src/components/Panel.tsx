import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Panel variant for different surface levels */
  variant?: "default" | "surface-1" | "surface-2" | "surface-3" | "glass" | "noise";
  /** Floating panel with more prominent shadow */
  floating?: boolean;
  /** Enable border */
  bordered?: boolean;
}

/**
 * Panel component following NeuralForge design system
 *
 * Features:
 * - Surface hierarchy (surface-1/2/3) for depth
 * - Glass variant with backdrop blur for overlays
 * - Noise variant for texture
 * - Soft shadows scaled to elevation
 */
export const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ className, variant = "default", floating, bordered, children, ...props }, ref) => {
    const variants = {
      default: "bg-card",
      "surface-1": "bg-bg-surface-1",
      "surface-2": "bg-bg-surface-2",
      "surface-3": "bg-bg-surface-3",
      glass: [
        "bg-bg-glass",
        "backdrop-blur-xl",
        "-webkit-backdrop-blur-xl",
      ].join(" "),
      noise: [
        "bg-bg-surface-1",
        "relative",
        // Noise is added via CSS utility class bg-noise
      ].join(" "),
    };

    const shadows = {
      default: "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.1)] dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.3)]",
      floating: "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)] dark:shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5)]",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-xl",
          variants[variant],
          floating ? shadows.floating : shadows.default,
          bordered && "border border-border-subtle",
          variant === "noise" && "bg-noise",
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Panel.displayName = "Panel";
