import {
  Root,
  CollapsibleTrigger as Trigger,
  CollapsibleContent as RadixContent,
} from "@radix-ui/react-collapsible";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

/**
 * Collapsible — show/hide section content with height animation.
 *
 * Animations use `collapsible-down` / `collapsible-up` keyframes from
 * @solo/ui motion tokens. The container's `overflow-hidden` is required for
 * the height-based animation to clip.
 */
export const Collapsible = Root;
export const CollapsibleTrigger = Trigger;

export const CollapsibleContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof RadixContent>
>(({ className, ...props }, ref) => (
  <RadixContent
    ref={ref}
    className={cn(
      "overflow-hidden",
      "data-[state=open]:animate-[collapsible-down_200ms_cubic-bezier(0.16,1,0.3,1)]",
      "data-[state=closed]:animate-[collapsible-up_150ms_cubic-bezier(0.16,1,0.3,1)]",
      className,
    )}
    {...props}
  />
));
CollapsibleContent.displayName = "CollapsibleContent";
