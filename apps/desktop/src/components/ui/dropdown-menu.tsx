// Local shim — re-exports @solo/ui Menu primitives under the legacy
// `DropdownMenu*` naming so existing call sites keep compiling.
export {
  Menu as DropdownMenu,
  MenuTrigger as DropdownMenuTrigger,
  MenuGroup as DropdownMenuGroup,
  MenuPortal as DropdownMenuPortal,
  MenuSub as DropdownMenuSub,
  MenuRadioGroup as DropdownMenuRadioGroup,
  MenuContent as DropdownMenuContent,
  MenuItem as DropdownMenuItem,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuRadioItem as DropdownMenuRadioItem,
  MenuLabel as DropdownMenuLabel,
  MenuSeparator as DropdownMenuSeparator,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuSubContent as DropdownMenuSubContent,
  MenuShortcut as DropdownMenuShortcut,
} from "@solo/ui";
