// @solo/ui — shared primitive library
//
// Every primitive consumes design tokens from @solo/ui/tokens; call sites
// should never pass raw color/radius/shadow/motion values through `className`.
// See packages/ui/src/skill-reconciliation.md for rule deviations.

// ── Base primitives (no Radix) ──────────────────────────────────────────
export { Button, type ButtonProps } from "./components/Button";
export { IconButton, type IconButtonProps } from "./components/IconButton";
export { Input, type InputProps } from "./components/Input";
export { Textarea, type TextareaProps } from "./components/Textarea";
export { Panel, type PanelProps } from "./components/Panel";
export { Skeleton, type SkeletonProps } from "./components/Skeleton";
export { Badge, type BadgeProps } from "./components/Badge";
export { Kbd, type KbdProps } from "./components/Kbd";
export { Separator, type SeparatorProps } from "./components/Separator";
export { Spinner, type SpinnerProps } from "./components/Spinner";

// ── Radix-backed primitives ─────────────────────────────────────────────
export {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  type TooltipContentProps,
} from "./components/Tooltip";

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogContentProps,
} from "./components/Dialog";

export {
  Menu,
  MenuTrigger,
  MenuGroup,
  MenuSub,
  MenuRadioGroup,
  MenuContent,
  MenuItem,
  MenuCheckboxItem,
  MenuRadioItem,
  MenuLabel,
  MenuSeparator,
  MenuSubTrigger,
  MenuSubContent,
} from "./components/Menu";

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "./components/ContextMenu";

export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  type TabsListProps,
  type TabsTriggerProps,
} from "./components/Tabs";

export { ScrollArea, ScrollBar } from "./components/ScrollArea";

export { Switch, type SwitchProps } from "./components/Switch";
export { Checkbox, type CheckboxProps } from "./components/Checkbox";
export { RadioGroup, RadioItem, type RadioItemProps } from "./components/Radio";

export {
  Select,
  SelectValue,
  SelectGroup,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  type SelectTriggerProps,
} from "./components/Select";

export {
  Popover,
  PopoverTrigger,
  PopoverClose,
  PopoverAnchor,
  PopoverContent,
  type PopoverContentProps,
} from "./components/Popover";

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  type AvatarProps,
} from "./components/Avatar";

export { Toaster, toast } from "./components/Toast";

// ── Utilities ───────────────────────────────────────────────────────────
export { cn } from "./utils/cn";
