import { useLayoutEffect } from 'react';

import { useSettingsStore } from '@/stores/settingsStore';

import type { ThemeSurface } from '@/stores/settingsStore';

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const mix = (a: string, aPercent: number, b: string): string =>
  `color-mix(in srgb, ${a} ${String(Math.round(aPercent))}%, ${b})`;

export function useAppearanceTheme(surface: ThemeSurface): void {
  const appearance = useSettingsStore((s) => s.appearance);
  const theme = appearance[surface];

  useLayoutEffect(() => {
    const root = document.documentElement;
    const contrast = clamp(theme.contrast, 0, 100);
    const sidebarOpacity = clamp(58 + contrast * 0.38, 62, 94);
    const cardOpacity = clamp(68 + contrast * 0.22, 70, 92);
    const borderOpacity = clamp(8 + contrast * 0.18, 10, 28);
    const mutedText = clamp(42 + contrast * 0.24, 46, 70);
    const accentWash = surface === 'dark' ? 16 : 10;
    const panelWash = surface === 'dark' ? 12 : 5;
    const toolWash = surface === 'dark' ? 14 : 7;
    const userMessageWash = surface === 'dark' ? 18 : 8;

    root.style.setProperty('--solo-theme-accent', theme.accent);
    root.style.setProperty('--solo-theme-background', theme.background);
    root.style.setProperty('--solo-theme-foreground', theme.foreground);
    root.style.setProperty('--background', theme.background);
    root.style.setProperty('--foreground', theme.foreground);
    root.style.setProperty('--primary', theme.accent);
    root.style.setProperty('--primary-foreground', surface === 'dark' ? '#0b0b0b' : '#ffffff');
    root.style.setProperty('--secondary', mix(theme.foreground, panelWash, theme.background));
    root.style.setProperty('--secondary-foreground', theme.foreground);
    root.style.setProperty('--ring', mix(theme.accent, 72, 'transparent'));
    root.style.setProperty('--accent', mix(theme.accent, accentWash, theme.background));
    root.style.setProperty('--accent-foreground', theme.foreground);
    root.style.setProperty('--muted', mix(theme.foreground, surface === 'dark' ? 12 : 7, theme.background));
    root.style.setProperty('--muted-foreground', mix(theme.foreground, mutedText, theme.background));
    root.style.setProperty('--border', mix(theme.foreground, borderOpacity, 'transparent'));
    root.style.setProperty('--input', mix(theme.foreground, borderOpacity + 4, 'transparent'));
    root.style.setProperty('--card', mix(theme.background, cardOpacity, 'transparent'));
    root.style.setProperty('--card-foreground', theme.foreground);
    root.style.setProperty('--popover', mix(theme.background, clamp(cardOpacity + 8, 78, 97), 'transparent'));
    root.style.setProperty('--popover-foreground', theme.foreground);
    root.style.setProperty('--sidebar', mix(theme.background, sidebarOpacity, 'transparent'));
    root.style.setProperty('--sidebar-foreground', theme.foreground);
    root.style.setProperty('--sidebar-primary', theme.accent);
    root.style.setProperty('--sidebar-accent', mix(theme.accent, accentWash + 3, theme.background));
    root.style.setProperty('--sidebar-border', mix(theme.foreground, borderOpacity, 'transparent'));
    root.style.setProperty('--chat-area', mix(theme.background, surface === 'dark' ? 98 : 96, theme.foreground));
    root.style.setProperty('--tool-output-bg', mix(theme.foreground, toolWash, theme.background));
    root.style.setProperty('--border-tool', mix(theme.foreground, borderOpacity + 2, 'transparent'));
    root.style.setProperty('--agent-user-bg', mix(theme.accent, userMessageWash, theme.background));
    root.style.setProperty('--agent-assistant-bg', 'transparent');
    root.style.setProperty('--agent-tool-bg', mix(theme.foreground, toolWash, theme.background));
    root.style.setProperty('--agent-streaming', mix(theme.foreground, mutedText + 8, theme.background));
    root.style.setProperty('--font-sans', theme.uiFontFamily);
    root.style.setProperty('--font-mono', theme.codeFontFamily);
    root.style.setProperty('--liquid-sidebar-bg', mix(theme.background, sidebarOpacity, 'transparent'));
    root.style.setProperty('--liquid-sidebar-border', mix(theme.foreground, borderOpacity + 6, 'transparent'));
    root.style.setProperty('--liquid-sidebar-highlight', mix('#ffffff', surface === 'dark' ? 7 : 38, 'transparent'));
    root.style.setProperty('--liquid-sidebar-active', mix(theme.accent, surface === 'dark' ? 18 : 12, theme.background));
    root.style.setProperty('--liquid-sidebar-hover', mix(theme.foreground, surface === 'dark' ? 8 : 5, 'transparent'));
    root.style.setProperty(
      '--liquid-sidebar-shadow',
      surface === 'dark'
        ? '24px 0 60px -44px rgb(0 0 0 / 0.75), inset -1px 0 0 rgb(255 255 255 / 0.04)'
        : '20px 0 44px -38px rgb(25 20 12 / 0.32), inset -1px 0 0 rgb(255 255 255 / 0.58)',
    );
    root.style.colorScheme = surface;
    root.dataset.translucentSidebar = String(theme.translucentSidebar);
    root.dataset.fontSmoothing = theme.fontSmoothing ? 'antialiased' : 'auto';
    root.dataset.soloThemeSurface = surface;
  }, [surface, theme]);
}
