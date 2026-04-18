// Shared types for the codex-extract pipeline.
// CDP message shapes are partial — we only declare fields we read.

export interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface CdpClient {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(method: string, handler: (params: unknown) => void): () => void;
  close(): Promise<void>;
}

export interface ExtractorContext {
  cdp: CdpClient;
  outDir: string;
  logger: Logger;
  archetypes: Archetype[];
}

export interface Logger {
  info(msg: string, ...rest: unknown[]): void;
  warn(msg: string, ...rest: unknown[]): void;
  error(msg: string, ...rest: unknown[]): void;
  child(prefix: string): Logger;
}

export interface Archetype {
  name: string;
  description?: string;
  selectors: string[];
  states?: Array<'default' | 'hover' | 'focus' | 'active' | 'disabled'>;
}

export interface StylesheetDump {
  index: number;
  styleSheetId: string;
  href: string;
  origin: 'user-agent' | 'author' | 'inspector' | 'injected' | 'regular';
  title?: string;
  disabled: boolean;
  text: string | null;
  textError?: string;
}

export interface ComputedStyleDump {
  archetype: string;
  matchedSelector: string | null;
  states: Record<string, Record<string, string> | null>;
  missing: boolean;
}

export interface TokenDump {
  name: string;
  value: string;
  scope: string;
}

export interface FontDump {
  family: string;
  weight: string;
  style: string;
  display: string;
  stretch: string;
  unicodeRange: string;
  status: string;
}

export interface KeyframesDump {
  name: string;
  definition: string;
  consumers: string[];
}

export interface AssetDump {
  url: string;
  origin: 'img' | 'background-image' | 'svg-use';
  kind: 'image' | 'svg' | 'font' | 'unknown';
  sizeBytes?: number;
  downloaded: boolean;
  localPath?: string;
}

export interface RunManifest {
  extractedAt: string;
  codexVersion?: string;
  mode: 'automated' | 'attached' | 'manual' | 'static-asar';
  url?: string;
  archetypes: {
    total: number;
    matched: number;
    missing: string[];
  };
  counts: {
    stylesheets: number;
    tokens: number;
    fonts: number;
    keyframes: number;
    assets: number;
  };
  warnings: string[];
  durationMs: number;
}
