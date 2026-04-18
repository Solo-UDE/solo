// Chrome tokens — IDE-specific measurements ported from Codex extraction.
//
// These are the values Codex uses for its own chrome (toolbars, sidebars,
// conversation layout). Having them as tokens means Solo's panels can mirror
// the Codex rhythm exactly without re-deriving the numbers each time.

export const chromeTokens = {
  // Toolbar heights — Codex uses 46/36 split (default/sm)
  toolbarHeight:     '46px',   // ← --height-toolbar
  toolbarHeightSm:   '36px',   // ← --height-toolbar-sm
  toolbarInset:      '46px',   // ← --inset-toolbar
  toolbarInsetSm:    '36px',   // ← --inset-toolbar-sm
  toolbarPadding:    '1rem',   // ← --padding-toolbar (calc(.25rem*4) = 1rem)
  toolbarPaneHeight: '40px',   // ← --height-toolbar-pane

  // Sidebar — responsive clamp from Codex
  sidebarWidth: 'clamp(240px, 300px, min(520px, calc(100vw - 320px)))', // ← --spacing-token-sidebar

  // Chat / conversation spacing
  chatFontSize:               '13px', // ← --codex-chat-font-size (matches Solo text-sm)
  chatCodeFontSize:           '12px', // ← --codex-chat-code-font-size
  conversationBlockGap:       '12px', // ← --conversation-block-gap
  conversationToolAssistantGap:'16px',// ← --conversation-tool-assistant-gap

  // Composer (chat input) spacing
  composerButtonSize:   'calc(0.25rem * 7)', // ← --spacing-token-button-composer (1.75rem)
  composerButtonSizeSm: 'calc(0.25rem * 5)', // ← --spacing-token-button-composer-sm (1.25rem)
  composerButtonGap:    '0.25rem',           // ← --spacing-token-button-composer-gap

  // Diffs panel — Codex-flat tight code view
  diffsFontFamily:        'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  diffsFontSize:          '12px',    // ← --diffs-font-size
  diffsLineHeight:        '1.8',     // ← --diffs-line-height (12px × 1.8)
  diffsMinNumberColumn:   '4ch',     // ← --diffs-min-number-column-width
} as const;

export type ChromeTokenName = keyof typeof chromeTokens;
