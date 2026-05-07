import { useMemo, useState } from 'react';
import { Check, Download, Moon, RotateCcw, Sun } from 'lucide-react';

import {
  APPEARANCE_PRESETS,
  FONT_FAMILIES,
  UI_FONT_FAMILIES,
  useSettingsStore,
  type ThemePalette,
  type ThemeSurface,
} from '@/stores/settingsStore';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SelectDropdown, ThemeSelector } from '../controls';

const SURFACES: Array<{ value: ThemeSurface; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

const PRESET_OPTIONS = [
  { value: 'solo', label: APPEARANCE_PRESETS.solo.label },
  { value: 'codex', label: APPEARANCE_PRESETS.codex.label },
  { value: 'watermelon', label: APPEARANCE_PRESETS.watermelon.label },
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

function hslToHex(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const toRgb = (n: number) => {
    const k = (n + hue * 12) % 12;
    const a = sat * Math.min(light, 1 - light);
    return light - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${toHex(toRgb(0))}${toHex(toRgb(8))}${toHex(toRgb(4))}`;
}

function parseCssColor(raw: string): string | null {
  const value = raw.trim().replace(/\/.*$/, '').trim();
  const shortHex = value.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) {
    return `#${shortHex[1]!.split('').map((c) => c + c).join('')}`;
  }
  if (HEX.test(value)) return value;

  const hslFunction = value.match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/i);
  if (hslFunction) {
    return hslToHex(Number(hslFunction[1]), Number(hslFunction[2]), Number(hslFunction[3]));
  }

  const shadcnHsl = value.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (shadcnHsl) {
    return hslToHex(Number(shadcnHsl[1]), Number(shadcnHsl[2]), Number(shadcnHsl[3]));
  }

  const rgb = value.match(/^rgb\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) {
    const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${toHex(Number(rgb[1]))}${toHex(Number(rgb[2]))}${toHex(Number(rgb[3]))}`;
  }

  return null;
}

function parseThemeCss(css: string): Partial<ThemePalette> {
  const patch: Partial<ThemePalette> = {};
  const re = /--([a-z-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const name = match[1];
    const color = parseCssColor(match[2] ?? '');
    if (!color) continue;
    if (name === 'background') patch.background = color;
    if (name === 'foreground') patch.foreground = color;
    if (name === 'primary' || name === 'accent') patch.accent = color;
  }
  return patch;
}

function colorValue(value: string): string {
  return HEX.test(value) ? value : '#000000';
}

export function AppearanceTab() {
  const colorScheme = useSettingsStore((s) => s.general.colorScheme);
  const appearance = useSettingsStore((s) => s.appearance);
  const setColorScheme = useSettingsStore((s) => s.setColorScheme);
  const setThemePalette = useSettingsStore((s) => s.setThemePalette);
  const setAppearancePreset = useSettingsStore((s) => s.setAppearancePreset);
  const resetAppearance = useSettingsStore((s) => s.resetAppearance);
  const [editingSurface, setEditingSurface] = useState<ThemeSurface>('dark');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const theme = appearance[editingSurface];

  const selectedPresetLabel = useMemo(() => {
    if (appearance.activePreset === 'custom') return 'Custom';
    return APPEARANCE_PRESETS[appearance.activePreset].label;
  }, [appearance.activePreset]);

  const update = (patch: Partial<ThemePalette>) => {
    setThemePalette(editingSurface, patch);
  };

  const applyImport = () => {
    const patch = parseThemeCss(importText);
    if (!patch.accent && !patch.background && !patch.foreground) {
      setImportError('No supported color variables found.');
      return;
    }
    setThemePalette(editingSurface, patch);
    setImportOpen(false);
    setImportText('');
    setImportError(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Theme</h3>
            <p className="mt-1 text-xs text-muted-foreground">Light, dark, or system.</p>
          </div>
          <div className="rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs text-muted-foreground">
            {selectedPresetLabel}
          </div>
        </div>
        <ThemeSelector value={colorScheme} onChange={setColorScheme} />
      </section>

      <section className="overflow-hidden rounded-[10px] border border-border/70 bg-card/75">
        <div className="grid grid-cols-2 border-b border-border/60 bg-background/45 text-xs">
          <CodePreview surface="light" />
          <CodePreview surface="dark" />
        </div>

        <div className="flex flex-col gap-0 divide-y divide-border/65">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-medium text-foreground">Editing</span>
            <div className="inline-flex rounded-full bg-background/70 p-1">
              {SURFACES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEditingSurface(value)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs transition-colors',
                    editingSurface === value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-medium text-foreground">Preset</span>
            <div className="flex flex-wrap justify-end gap-2">
              {PRESET_OPTIONS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setAppearancePreset(preset.value)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-3 text-xs transition-colors',
                    appearance.activePreset === preset.value
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border/70 bg-background/55 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {appearance.activePreset === preset.value ? <Check className="h-3.5 w-3.5" /> : null}
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <ColorRow label="Accent" value={theme.accent} onChange={(accent) => update({ accent })} />
          <ColorRow label="Background" value={theme.background} onChange={(background) => update({ background })} />
          <ColorRow label="Foreground" value={theme.foreground} onChange={(foreground) => update({ foreground })} />

          <SelectRow
            label="UI font"
            value={theme.uiFontFamily}
            options={UI_FONT_FAMILIES}
            onChange={(uiFontFamily) => update({ uiFontFamily })}
          />
          <SelectRow
            label="Code font"
            value={theme.codeFontFamily}
            options={FONT_FAMILIES}
            onChange={(codeFontFamily) => update({ codeFontFamily })}
          />

          <ToggleRow
            label="Translucent sidebar"
            checked={theme.translucentSidebar}
            onChange={(translucentSidebar) => update({ translucentSidebar })}
          />
          <SliderRow
            label="Contrast"
            value={theme.contrast}
            onChange={(contrast) => update({ contrast })}
          />
          <ToggleRow
            label="Font smoothing"
            checked={theme.fontSmoothing}
            onChange={(fontSmoothing) => update({ fontSmoothing })}
          />
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-border/70 bg-background/65 px-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <Download className="h-4 w-4" />
          Import CSS
        </button>
        <button
          type="button"
          onClick={resetAppearance}
          className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-border/70 bg-background/65 px-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </button>
      </div>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Custom Theme CSS</DialogTitle>
            <DialogDescription>
              Paste shadcn CSS variables for the selected theme.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={importText}
            onChange={(event) => {
              setImportText(event.target.value);
              setImportError(null);
            }}
            spellCheck={false}
            className="min-h-[260px] w-full resize-y rounded-[8px] border border-border bg-background p-3 font-mono text-sm text-foreground outline-none focus:border-primary/60"
            placeholder="--background: 0 0% 100%;&#10;--foreground: 222.2 84% 4.9%;"
          />
          {importError ? <p className="text-xs text-destructive">{importError}</p> : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setImportOpen(false)}
              className="h-8 rounded-[8px] border border-border/70 px-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyImport}
              className="h-8 rounded-[8px] bg-primary px-3 text-sm font-medium text-primary-foreground"
            >
              Apply Theme Variables
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CodePreview({ surface }: { surface: ThemeSurface }) {
  const preset = APPEARANCE_PRESETS.codex[surface];
  return (
    <div
      className="min-w-0 border-r border-border/60 px-4 py-3 font-mono text-[11px] leading-5 last:border-r-0"
      style={{ background: preset.background, color: preset.foreground }}
    >
      <div><span style={{ color: preset.accent }}>const</span> themePreview = &#123;</div>
      <div className="pl-4">surface: "{surface}-glass",</div>
      <div className="pl-4">accent: "{preset.accent}",</div>
      <div className="pl-4">contrast: {preset.contrast},</div>
      <div>&#125;;</div>
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-foreground">{label}</span>
      <label className="inline-flex h-8 items-center gap-2 rounded-[8px] bg-background/75 px-2">
        <input
          type="color"
          value={colorValue(value)}
          onChange={(event) => onChange(event.target.value)}
          className="h-5 w-5 rounded-full border-0 bg-transparent p-0"
        />
        <span className="w-[72px] text-xs font-medium tabular-nums text-muted-foreground">{value.toUpperCase()}</span>
      </label>
    </div>
  );
}

function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { label: string; value: T }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-foreground">{label}</span>
      <SelectDropdown
        value={value}
        options={options}
        onChange={onChange}
        className="max-w-[230px]"
        label={label}
      />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-foreground">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
    </div>
  );
}

function SliderRow({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-36 accent-primary"
        />
        <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{value}</span>
      </div>
    </div>
  );
}
