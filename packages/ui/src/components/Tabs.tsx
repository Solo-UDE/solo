import { Root, List, Trigger, Content } from "@radix-ui/react-tabs";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export const Tabs = Root;

export interface TabsListProps extends ComponentPropsWithoutRef<typeof List> {
  variant?: "default" | "pills";
}

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const variants = {
      default: "border-b border-border/60",
      pills: "gap-1 p-1 bg-muted/40 rounded-md",
    };
    return (
      <List
        ref={ref}
        className={cn("inline-flex items-center", variants[variant], className)}
        {...props}
      />
    );
  },
);
TabsList.displayName = "TabsList";

export interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof Trigger> {
  variant?: "default" | "pills";
  size?: "sm" | "md";
}

export const TabsTrigger = forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    const sizes = {
      sm: "h-7 px-2 text-[12px]",
      md: "h-8 px-3 text-[13px]",
    };
    const variants = {
      default:
        "relative font-medium text-muted-foreground " +
        "data-[state=active]:text-foreground " +
        "after:absolute after:left-0 after:right-0 after:-bottom-px after:h-[2px] " +
        "after:bg-primary after:scale-x-0 data-[state=active]:after:scale-x-100 " +
        "after:origin-center after:transition-transform after:duration-200 after:ease-[cubic-bezier(0.16,1,0.3,1)]",
      pills:
        "rounded-sm font-medium text-muted-foreground " +
        "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
    };
    return (
      <Trigger
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
          "transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:opacity-50 disabled:pointer-events-none",
          sizes[size],
          variants[variant],
          className,
        )}
        {...props}
      />
    );
  },
);
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Content>
>(({ className, ...props }, ref) => (
  <Content
    ref={ref}
    className={cn(
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
