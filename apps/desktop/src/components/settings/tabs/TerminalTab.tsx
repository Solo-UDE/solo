/**
 * TerminalTab - Terminal appearance settings
 */

import {
  useSettingsStore,
  FONT_FAMILIES,
  CURSOR_STYLE_OPTIONS,
  type CursorStyle,
} from '../../../stores/settingsStore';
import { SettingRow, SelectDropdown, NumberInput } from '../controls';

export function TerminalTab() {
  const fontFamily = useSettingsStore((s) => s.terminal.fontFamily);
  const fontSize = useSettingsStore((s) => s.terminal.fontSize);
  const cursorStyle = useSettingsStore((s) => s.terminal.cursorStyle);

  const setTerminalFontFamily = useSettingsStore((s) => s.setTerminalFontFamily);
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  const setTerminalCursorStyle = useSettingsStore((s) => s.setTerminalCursorStyle);

  return (
    <div className="space-y-8">
      {/* Appearance */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Appearance
        </h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="Font Family"
            description="Monospace font for the terminal"
          >
            <SelectDropdown
              value={fontFamily}
              options={FONT_FAMILIES}
              onChange={setTerminalFontFamily}
            />
          </SettingRow>

          <SettingRow
            label="Font Size"
            description="Terminal text size (10-24px)"
          >
            <NumberInput
              value={fontSize}
              min={10}
              max={24}
              step={1}
              onChange={setTerminalFontSize}
            />
          </SettingRow>

          <SettingRow
            label="Cursor Style"
            description="Shape of the terminal cursor"
          >
            <SelectDropdown<CursorStyle>
              value={cursorStyle}
              options={CURSOR_STYLE_OPTIONS}
              onChange={setTerminalCursorStyle}
            />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}
