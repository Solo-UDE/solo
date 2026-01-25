import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Floating panel with more prominent shadow */
  floating?: boolean;
  /** Enable backdrop blur */
  blur?: boolean;
}

/**
 * Panel component following Solo/Orbit design system
 *
 * Features:
 * - Soft shadows instead of borders
 * - Optional glassmorphism (backdrop blur)
 * - Generous border radius
 */
export const Panel = forwardRef<HTMLDivElement, PanelProps>(
  ({ className, floating, blur, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-[14px] bg-card/95",
          floating
            ? "shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)]"
            : "shadow-lg",
          blur && "backdrop-blur-md",
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
