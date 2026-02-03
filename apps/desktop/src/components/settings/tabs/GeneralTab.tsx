/**
 * GeneralTab - Color scheme, font settings
 */

import { useSettingsStore, FONT_FAMILIES, type ColorScheme } from '../../../stores/settingsStore';
import { SettingRow, SelectDropdown, NumberInput } from '../controls';

const COLOR_SCHEME_OPTIONS: { label: string; value: ColorScheme }[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export function GeneralTab() {
  const colorScheme = useSettingsStore((s) => s.general.colorScheme);
  const editorFontFamily = useSettingsStore((s) => s.general.editorFontFamily);
  const editorFontSize = useSettingsStore((s) => s.general.editorFontSize);

  const setColorScheme = useSettingsStore((s) => s.setColorScheme);
  const setEditorFontFamily = useSettingsStore((s) => s.setEditorFontFamily);
  const setEditorFontSize = useSettingsStore((s) => s.setEditorFontSize);

  return (
    <div className="space-y-8">
      {/* Appearance Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Appearance
        </h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="Color Scheme"
            description="Choose light, dark, or match your system preference"
          >
            <SelectDropdown
              value={colorScheme}
              options={COLOR_SCHEME_OPTIONS}
              onChange={setColorScheme}
            />
          </SettingRow>

          <SettingRow
            label="Editor Font"
            description="Monospace font for code editing"
          >
            <SelectDropdown
              value={editorFontFamily}
              options={FONT_FAMILIES}
              onChange={setEditorFontFamily}
            />
          </SettingRow>

          <SettingRow
            label="Font Size"
            description="Editor text size (10-24px)"
          >
            <NumberInput
              value={editorFontSize}
              min={10}
              max={24}
              step={1}
              onChange={setEditorFontSize}
            />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}
