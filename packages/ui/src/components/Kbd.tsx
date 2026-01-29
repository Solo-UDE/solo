import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** Size variant */
  size?: "sm" | "md";
}

/**
 * Kbd component for displaying keyboard shortcuts
 *
 * Features:
 * - Inset shadow for key-like appearance
 * - Monospace font for consistency
 * - Subtle border for definition
 */
export const Kbd = forwardRef<HTMLElement, KbdProps>(
  ({ className, size = "sm", children, ...props }, ref) => {
    const sizes = {
      sm: "h-5 min-w-5 px-1.5 text-[10px]",
      md: "h-6 min-w-6 px-2 text-xs",
    };

    return (
      <kbd
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center",
          "font-mono font-medium",
          "rounded",
          "bg-bg-surface-2 text-muted-foreground",
          "border border-border-subtle",
          "shadow-[0_1px_0_1px_rgba(0,0,0,0.1),inset_0_0_0_1px_rgba(255,255,255,0.03)]",
          "dark:shadow-[0_1px_0_1px_rgba(0,0,0,0.3),inset_0_0_0_1px_rgba(255,255,255,0.03)]",
          sizes[size],
          className
        )}
        {...props}
      >
        {children}
      </kbd>
    );
  }
);

Kbd.displayName = "Kbd";

/**
 * Helper to format keyboard shortcuts for display
 * Converts "Cmd+K" to platform-specific display
 */
export function formatShortcut(shortcut: string): string[] {
  const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return shortcut.split("+").map((key) => {
    const normalized = key.trim().toLowerCase();

    if (normalized === "cmd" || normalized === "meta") {
      return isMac ? "⌘" : "Ctrl";
    }
    if (normalized === "ctrl") {
      return isMac ? "⌃" : "Ctrl";
    }
    if (normalized === "alt" || normalized === "option") {
      return isMac ? "⌥" : "Alt";
    }
    if (normalized === "shift") {
      return isMac ? "⇧" : "Shift";
    }
    if (normalized === "enter" || normalized === "return") {
      return isMac ? "↩" : "Enter";
    }
    if (normalized === "escape" || normalized === "esc") {
      return "Esc";
    }
    if (normalized === "backspace") {
      return isMac ? "⌫" : "Backspace";
    }
    if (normalized === "delete") {
      return isMac ? "⌦" : "Del";
    }
    if (normalized === "tab") {
      return "⇥";
    }
    if (normalized === "space") {
      return "Space";
    }
    if (normalized === "up") {
      return "↑";
    }
    if (normalized === "down") {
      return "↓";
    }
    if (normalized === "left") {
      return "←";
    }
    if (normalized === "right") {
      return "→";
    }

    // Capitalize single letters
    if (key.length === 1) {
      return key.toUpperCase();
    }

    // Return as-is for other keys
    return key;
  });
}

/**
 * Renders a keyboard shortcut with proper styling
 */
export function ShortcutDisplay({ shortcut, size = "sm" }: { shortcut: string; size?: "sm" | "md" }) {
  const keys = formatShortcut(shortcut);

  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((key, index) => (
        <Kbd key={index} size={size}>
          {key}
        </Kbd>
      ))}
    </span>
  );
}
