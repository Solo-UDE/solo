/**
 * GeneralTab - Theme selection, font settings
 */

import { useSettingsStore, FONT_FAMILIES } from '../../../stores/settingsStore';
import { SettingRow, SelectDropdown, NumberInput, ThemeSelector } from '../controls';

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
        <h3 className="text-xs font-semibold text-muted-foreground mb-4">
          Appearance
        </h3>

        <div className="mb-6">
          <div className="text-sm font-medium text-foreground mb-1">Theme</div>
          <div className="text-xs text-muted-foreground mb-4">
            Choose light, dark, or match your system preference
          </div>
          <ThemeSelector value={colorScheme} onChange={setColorScheme} />
        </div>

        <div className="divide-y divide-border">
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
