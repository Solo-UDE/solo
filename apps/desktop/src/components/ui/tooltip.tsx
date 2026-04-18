// Local shim — re-exports Tooltip primitives from @solo/ui so consumers of
// this path inherit the Codex-derived tokens (rounder radii, flatter shadows,
// tokenised motion). APIs are call-site-compatible with the prior shadcn
// wrapper; no migration required at import sites.
export {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@solo/ui";
