// Z-index tokens — layer ordering for the entire app.
// Use these instead of ad-hoc numeric z values so stacking is legible.

export const zIndexTokens = {
  base:     0,
  dropdown: 10,
  sticky:   20,
  overlay:  30,
  modal:    40,
  popover:  50,
  tooltip:  60,
  toast:    70,
} as const;

export type ZIndexName = keyof typeof zIndexTokens;
