// Local shim — re-exports Textarea from @solo/ui. The legacy `error?: boolean`
// prop is preserved via a deprecated alias on the @solo/ui primitive, so
// existing call sites continue to compile.
export { Textarea } from "@solo/ui";
