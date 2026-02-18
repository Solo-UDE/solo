/**
 * ThemeSelector - Visual preview cards for theme selection
 */

import { Monitor, Sun, Moon } from '@phosphor-icons/react';
import type { ColorScheme } from '@/stores/settingsStore';

interface ThemeSelectorProps {
  value: ColorScheme;
  onChange: (scheme: ColorScheme) => void;
}

// Hardcoded preview colors so each card always shows its theme regardless of current mode
const light = {
  bg: 'oklch(0.98 0.005 75)',
  sidebar: 'oklch(0.95 0.008 70)',
  titlebar: 'oklch(0.93 0.01 70)',
  text: 'oklch(0.50 0.03 60)',
  textFaint: 'oklch(0.75 0.02 60)',
  accent: 'oklch(0.68 0.17 140)',
};

const dark = {
  bg: 'oklch(0.16 0.012 60)',
  sidebar: 'oklch(0.18 0.012 58)',
  titlebar: 'oklch(0.14 0.01 58)',
  text: 'oklch(0.65 0.03 60)',
  textFaint: 'oklch(0.35 0.02 60)',
  accent: 'oklch(0.86 0.14 135)',
};

const trafficLights = (
  <div style={{ display: 'flex', gap: 3 }}>
    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#ff5f57' }} />
    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#febc2e' }} />
    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#28c840' }} />
  </div>
);

const CodeLines = ({ color, faintColor }: { color: string; faintColor: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '4px 5px' }}>
    <div style={{ height: 2, width: '70%', borderRadius: 1, background: color }} />
    <div style={{ height: 2, width: '50%', borderRadius: 1, background: faintColor }} />
    <div style={{ height: 2, width: '85%', borderRadius: 1, background: color }} />
    <div style={{ height: 2, width: '40%', borderRadius: 1, background: faintColor }} />
    <div style={{ height: 2, width: '60%', borderRadius: 1, background: color }} />
  </div>
);

const SidebarLines = ({ color }: { color: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '4px 3px' }}>
    <div style={{ height: 2, width: '80%', borderRadius: 1, background: color }} />
    <div style={{ height: 2, width: '60%', borderRadius: 1, background: color }} />
    <div style={{ height: 2, width: '70%', borderRadius: 1, background: color }} />
  </div>
);

/** Miniature IDE preview for light or dark theme */
const ThemePreview = ({ theme }: { theme: typeof light }) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      borderRadius: 6,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      background: theme.bg,
    }}
  >
    {/* Titlebar */}
    <div
      style={{
        height: 14,
        background: theme.titlebar,
        display: 'flex',
        alignItems: 'center',
        padding: '0 5px',
      }}
    >
      {trafficLights}
    </div>
    {/* Body */}
    <div style={{ flex: 1, display: 'flex' }}>
      {/* Sidebar */}
      <div style={{ width: '30%', background: theme.sidebar }}>
        <SidebarLines color={theme.textFaint} />
      </div>
      {/* Editor */}
      <div style={{ flex: 1 }}>
        <CodeLines color={theme.text} faintColor={theme.textFaint} />
      </div>
    </div>
  </div>
);

/** Split preview for "System" — left half light, right half dark */
const SystemPreview = () => (
  <div
    style={{
      width: '100%',
      height: '100%',
      borderRadius: 6,
      overflow: 'hidden',
      display: 'flex',
    }}
  >
    {/* Light half */}
    <div style={{ width: '50%', display: 'flex', flexDirection: 'column', background: light.bg }}>
      <div
        style={{
          height: 14,
          background: light.titlebar,
          display: 'flex',
          alignItems: 'center',
          padding: '0 5px',
        }}
      >
        {trafficLights}
      </div>
      <div style={{ flex: 1 }}>
        <CodeLines color={light.text} faintColor={light.textFaint} />
      </div>
    </div>
    {/* Dark half */}
    <div style={{ width: '50%', display: 'flex', flexDirection: 'column', background: dark.bg }}>
      <div style={{ height: 14, background: dark.titlebar }} />
      <div style={{ flex: 1 }}>
        <CodeLines color={dark.text} faintColor={dark.textFaint} />
      </div>
    </div>
  </div>
);

const options: { value: ColorScheme; label: string; Icon: typeof Monitor }[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

export function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  return (
    <div className="flex gap-3">
      {options.map(({ value: scheme, label, Icon }) => {
        const selected = value === scheme;
        return (
          <button
            key={scheme}
            type="button"
            onClick={() => onChange(scheme)}
            className={`
              group flex flex-col items-center gap-2 rounded-xl p-2 pb-2.5
              transition-[transform,box-shadow,border-color] duration-200
              ${selected
                ? 'bg-primary/10 ring-2 ring-primary shadow-md'
                : 'bg-muted/30 ring-1 ring-border/40 hover:ring-border/70 hover:shadow-sm'
              }
            `}
            style={{
              transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            {/* Preview card */}
            <div
              className={`
                w-[120px] h-[72px] rounded-md overflow-hidden
                transition-transform duration-200
                ${!selected ? 'group-hover:scale-[1.02]' : ''}
              `}
              style={{
                transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              {scheme === 'system' ? (
                <SystemPreview />
              ) : (
                <ThemePreview theme={scheme === 'light' ? light : dark} />
              )}
            </div>
            {/* Label */}
            <div className="flex items-center gap-1.5">
              <Icon
                size={14}
                weight={selected ? 'fill' : 'regular'}
                className={selected ? 'text-primary' : 'text-muted-foreground'}
              />
              <span
                className={`text-xs font-medium ${
                  selected ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
