// Color tokens — light + dark, OKLCH throughout.
//
// Source map:
//   warm-stone base + Solo-green accent — carried forward from
//   apps/desktop/src/index.css (the prior authoritative source). Values here
//   are byte-exact to preserve visual continuity. The Codex extraction
//   pipeline (scripts/codex-extract) will refine specific values as warranted.

interface ColorSet {
  // Surfaces
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
  chatArea: string;
  toolOutputBg: string;
  borderTool: string;

  // Semantic
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  destructive: string;
  destructiveForeground: string;
  ring: string;
  border: string;
  input: string;

  // Status
  statusSuccess: string;
  statusWarning: string;
  statusError: string;
  success: string;
  successMuted: string;
  successForeground: string;
  warning: string;
  warningMuted: string;
  warningForeground: string;
  info: string;
  infoMuted: string;
  infoForeground: string;

  // File types
  fileFolder: string;
  fileCode: string;
  fileConfig: string;
  fileText: string;
  fileImage: string;

  // Agent surfaces
  agentUserBg: string;
  agentAssistantBg: string;
  agentToolBg: string;
  agentStreaming: string;

  // Repo identity (10 hues × 3 stops)
  repoBlue: string; repoBlueMuted: string; repoBlueFg: string;
  repoOrange: string; repoOrangeMuted: string; repoOrangeFg: string;
  repoEmerald: string; repoEmeraldMuted: string; repoEmeraldFg: string;
  repoViolet: string; repoVioletMuted: string; repoVioletFg: string;
  repoRose: string; repoRoseMuted: string; repoRoseFg: string;
  repoAmber: string; repoAmberMuted: string; repoAmberFg: string;
  repoCyan: string; repoCyanMuted: string; repoCyanFg: string;
  repoTeal: string; repoTealMuted: string; repoTealFg: string;
  repoPink: string; repoPinkMuted: string; repoPinkFg: string;
  repoLime: string; repoLimeMuted: string; repoLimeFg: string;

  // Syntax highlighting
  syntaxKeyword: string;
  syntaxString: string;
  syntaxType: string;
  syntaxFunction: string;
  syntaxVariable: string;
  syntaxComment: string;
  syntaxNumber: string;
  syntaxControl: string;
  syntaxOperator: string;
  syntaxBracket: string;

  // Orbit Geist 10-step neutral scale (hex values — legacy)
  orbit100: string;
  orbit200: string;
  orbit300: string;
  orbit400: string;
  orbit500: string;
  orbit600: string;
  orbit700: string;
  orbit800: string;
  orbit900: string;
  orbit1000: string;
}

const light: ColorSet = {
  // Surfaces
  background:       'oklch(0.972 0.004 85)',
  foreground:       'oklch(0.24 0.008 85)',
  card:             'oklch(0.992 0.003 85)',
  cardForeground:   'oklch(0.24 0.008 85)',
  popover:          'oklch(0.99 0.003 85)',
  popoverForeground:'oklch(0.24 0.008 85)',
  muted:            'oklch(0.952 0.004 85)',
  mutedForeground:  'oklch(0.5 0.008 85)',
  accent:           'oklch(0.944 0.006 85)',
  accentForeground: 'oklch(0.22 0.006 85)',
  sidebar:          'oklch(0.955 0.004 85)',
  sidebarForeground:'oklch(0.22 0.008 85)',
  sidebarBorder:    'oklch(0.89 0.004 85)',
  chatArea:         'oklch(0.986 0.003 85)',
  toolOutputBg:     'oklch(0.968 0.003 85)',
  borderTool:       'oklch(0 0 0 / 0.06)',

  // Semantic
  primary:              'oklch(0.6 0.11 157)',
  primaryForeground:    'oklch(0.99 0.002 85)',
  secondary:            'oklch(0.945 0.004 85)',
  secondaryForeground:  'oklch(0.22 0.006 85)',
  destructive:          'oklch(0.55 0.22 25)',
  destructiveForeground:'oklch(0.985 0 0)',
  ring:                 'oklch(0.62 0.09 160)',
  border:               'oklch(0.89 0.004 85)',
  input:                'oklch(0.955 0.004 85)',

  // Status
  statusSuccess:     'oklch(0.65 0.18 155)',
  statusWarning:     'oklch(0.75 0.18 85)',
  statusError:       'oklch(0.55 0.22 25)',
  success:           'oklch(0.65 0.18 155)',
  successMuted:      'oklch(0.92 0.06 155)',
  successForeground: 'oklch(0.35 0.10 155)',
  warning:           'oklch(0.75 0.18 85)',
  warningMuted:      'oklch(0.92 0.06 85)',
  warningForeground: 'oklch(0.40 0.10 85)',
  info:              'oklch(0.60 0.15 240)',
  infoMuted:         'oklch(0.92 0.06 240)',
  infoForeground:    'oklch(0.35 0.10 240)',

  // File types
  fileFolder: 'oklch(0.75 0.15 85)',
  fileCode:   'oklch(0.60 0.15 240)',
  fileConfig: 'oklch(0.75 0.18 90)',
  fileText:   'oklch(0.50 0.03 60)',
  fileImage:  'oklch(0.65 0.18 300)',

  // Agent
  agentUserBg:      'oklch(0.943 0.004 85)',
  agentAssistantBg: 'transparent',
  agentToolBg:       'oklch(0.968 0.003 85)',  // mirrors toolOutputBg
  agentStreaming:   'oklch(0.54 0.01 80)',

  // Repo identity
  repoBlue: 'oklch(0.55 0.18 250)',    repoBlueMuted: 'oklch(0.55 0.18 250 / 12%)',   repoBlueFg: 'oklch(0.40 0.15 250)',
  repoOrange: 'oklch(0.65 0.18 55)',    repoOrangeMuted: 'oklch(0.65 0.18 55 / 12%)',  repoOrangeFg: 'oklch(0.48 0.15 55)',
  repoEmerald: 'oklch(0.60 0.17 160)',  repoEmeraldMuted: 'oklch(0.60 0.17 160 / 12%)', repoEmeraldFg: 'oklch(0.42 0.14 160)',
  repoViolet: 'oklch(0.55 0.20 290)',   repoVioletMuted: 'oklch(0.55 0.20 290 / 12%)',  repoVioletFg: 'oklch(0.40 0.17 290)',
  repoRose: 'oklch(0.60 0.20 15)',      repoRoseMuted: 'oklch(0.60 0.20 15 / 12%)',     repoRoseFg: 'oklch(0.45 0.17 15)',
  repoAmber: 'oklch(0.70 0.16 80)',     repoAmberMuted: 'oklch(0.70 0.16 80 / 12%)',    repoAmberFg: 'oklch(0.50 0.14 80)',
  repoCyan: 'oklch(0.60 0.14 210)',     repoCyanMuted: 'oklch(0.60 0.14 210 / 12%)',    repoCyanFg: 'oklch(0.42 0.12 210)',
  repoTeal: 'oklch(0.60 0.14 180)',     repoTealMuted: 'oklch(0.60 0.14 180 / 12%)',    repoTealFg: 'oklch(0.42 0.12 180)',
  repoPink: 'oklch(0.62 0.20 340)',     repoPinkMuted: 'oklch(0.62 0.20 340 / 12%)',    repoPinkFg: 'oklch(0.45 0.17 340)',
  repoLime: 'oklch(0.65 0.18 130)',     repoLimeMuted: 'oklch(0.65 0.18 130 / 12%)',    repoLimeFg: 'oklch(0.45 0.15 130)',

  // Syntax
  syntaxKeyword:  'oklch(0.48 0.20 240)',
  syntaxString:   'oklch(0.52 0.19 35)',
  syntaxType:     'oklch(0.48 0.17 175)',
  syntaxFunction: 'oklch(0.50 0.16 80)',
  syntaxVariable: 'oklch(0.44 0.14 220)',
  syntaxComment:  'oklch(0.5 0.1 140)',
  syntaxNumber:   'oklch(0.50 0.16 130)',
  syntaxControl:  'oklch(0.50 0.19 320)',
  syntaxOperator: 'oklch(0.35 0.02 60)',
  syntaxBracket:  'oklch(0.55 0.18 85)',

  // Orbit Geist
  orbit100:  '#dbdbdb',
  orbit200:  '#d2d2d2',
  orbit300:  '#cacaca',
  orbit400:  '#c1c1c1',
  orbit500:  '#b5b5b5',
  orbit600:  '#a1a1a1',
  orbit700:  '#737373',
  orbit800:  '#696969',
  orbit900:  '#4c4c4c',
  orbit1000: '#202020',
};

const dark: ColorSet = {
  // Surfaces
  background:       'oklch(0.145 0.006 75)',
  foreground:       'oklch(0.93 0.008 85)',
  card:             'oklch(0.18 0.006 75)',
  cardForeground:   'oklch(0.93 0.008 85)',
  popover:          'oklch(0.19 0.006 75)',
  popoverForeground:'oklch(0.93 0.008 85)',
  muted:            'oklch(0.2 0.006 75)',
  mutedForeground:  'oklch(0.7 0.008 82)',
  accent:           'oklch(0.22 0.007 75)',
  accentForeground: 'oklch(0.92 0.008 85)',
  sidebar:          'oklch(0.165 0.006 75)',
  sidebarForeground:'oklch(0.92 0.008 85)',
  sidebarBorder:    'oklch(0.3 0.01 70)',
  chatArea:         '#181818',
  toolOutputBg:     'oklch(0.19 0.006 75)',
  borderTool:       'oklch(0.32 0.01 70)',

  // Semantic
  primary:              'oklch(0.77 0.12 158)',
  primaryForeground:    'oklch(0.17 0.004 85)',
  secondary:            'oklch(0.22 0.006 75)',
  secondaryForeground:  'oklch(0.9 0.008 85)',
  destructive:          'oklch(0.65 0.20 25)',
  destructiveForeground:'oklch(0.985 0 0)',
  ring:                 'oklch(0.72 0.1 160)',
  border:               'oklch(0.34 0.01 70)',
  input:                'oklch(0.23 0.006 75)',

  // Status
  statusSuccess:     'oklch(0.70 0.18 155)',
  statusWarning:     'oklch(0.80 0.18 85)',
  statusError:       'oklch(0.65 0.20 25)',
  success:           'oklch(0.70 0.18 155)',
  successMuted:      'oklch(0.30 0.08 155)',
  successForeground: 'oklch(0.85 0.10 155)',
  warning:           'oklch(0.80 0.18 85)',
  warningMuted:      'oklch(0.30 0.08 85)',
  warningForeground: 'oklch(0.90 0.10 85)',
  info:              'oklch(0.70 0.15 240)',
  infoMuted:         'oklch(0.30 0.08 240)',
  infoForeground:    'oklch(0.85 0.10 240)',

  // File types
  fileFolder: 'oklch(0.80 0.18 90)',
  fileCode:   'oklch(0.65 0.15 240)',
  fileConfig: 'oklch(0.80 0.18 90)',
  fileText:   'oklch(0.65 0.03 60)',
  fileImage:  'oklch(0.60 0.18 300)',

  // Agent
  agentUserBg:      'oklch(0.2 0.006 75)',
  agentAssistantBg: 'transparent',
  agentToolBg:       'oklch(0.19 0.006 75)',
  agentStreaming:   'oklch(0.72 0.008 85)',

  // Repo identity
  repoBlue: 'oklch(0.70 0.16 250)',    repoBlueMuted: 'oklch(0.70 0.16 250 / 15%)',   repoBlueFg: 'oklch(0.80 0.12 250)',
  repoOrange: 'oklch(0.75 0.16 55)',    repoOrangeMuted: 'oklch(0.75 0.16 55 / 15%)',  repoOrangeFg: 'oklch(0.85 0.12 55)',
  repoEmerald: 'oklch(0.72 0.15 160)',  repoEmeraldMuted: 'oklch(0.72 0.15 160 / 15%)', repoEmeraldFg: 'oklch(0.82 0.12 160)',
  repoViolet: 'oklch(0.70 0.18 290)',   repoVioletMuted: 'oklch(0.70 0.18 290 / 15%)',  repoVioletFg: 'oklch(0.82 0.14 290)',
  repoRose: 'oklch(0.72 0.18 15)',      repoRoseMuted: 'oklch(0.72 0.18 15 / 15%)',     repoRoseFg: 'oklch(0.85 0.14 15)',
  repoAmber: 'oklch(0.80 0.14 80)',     repoAmberMuted: 'oklch(0.80 0.14 80 / 15%)',    repoAmberFg: 'oklch(0.88 0.10 80)',
  repoCyan: 'oklch(0.72 0.12 210)',     repoCyanMuted: 'oklch(0.72 0.12 210 / 15%)',    repoCyanFg: 'oklch(0.82 0.10 210)',
  repoTeal: 'oklch(0.72 0.12 180)',     repoTealMuted: 'oklch(0.72 0.12 180 / 15%)',    repoTealFg: 'oklch(0.82 0.10 180)',
  repoPink: 'oklch(0.74 0.18 340)',     repoPinkMuted: 'oklch(0.74 0.18 340 / 15%)',    repoPinkFg: 'oklch(0.85 0.14 340)',
  repoLime: 'oklch(0.76 0.16 130)',     repoLimeMuted: 'oklch(0.76 0.16 130 / 15%)',    repoLimeFg: 'oklch(0.86 0.12 130)',

  // Syntax
  syntaxKeyword:  'oklch(0.68 0.18 240)',
  syntaxString:   'oklch(0.72 0.18 40)',
  syntaxType:     'oklch(0.72 0.18 175)',
  syntaxFunction: 'oklch(0.78 0.16 90)',
  syntaxVariable: 'oklch(0.74 0.14 220)',
  syntaxComment:  'oklch(0.55 0.1 140)',
  syntaxNumber:   'oklch(0.74 0.16 130)',
  syntaxControl:  'oklch(0.72 0.18 320)',
  syntaxOperator: 'oklch(0.85 0.02 60)',
  syntaxBracket:  'oklch(0.80 0.18 85)',

  // Orbit Geist
  orbit100:  '#232323',
  orbit200:  '#2a2a2a',
  orbit300:  '#313131',
  orbit400:  '#3a3a3a',
  orbit500:  '#484848',
  orbit600:  '#606060',
  orbit700:  '#6d6d6d',
  orbit800:  '#7b7b7b',
  orbit900:  '#b3b3b3',
  orbit1000: '#eeeeee',
};

export const colorTokens = { light, dark } as const;
export type ColorTokenName = keyof ColorSet;
