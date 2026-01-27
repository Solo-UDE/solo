/**
 * EditorTab - Code editing preferences
 */

import {
  useSettingsStore,
  TAB_SIZE_OPTIONS,
  LINE_NUMBER_OPTIONS,
  type TabSize,
  type LineNumbers,
} from '../../../stores/settingsStore';
import { SettingRow, SelectDropdown, ToggleSwitch } from '../controls';

export function EditorTab() {
  const tabSize = useSettingsStore((s) => s.editor.tabSize);
  const wordWrap = useSettingsStore((s) => s.editor.wordWrap);
  const minimap = useSettingsStore((s) => s.editor.minimap);
  const lineNumbers = useSettingsStore((s) => s.editor.lineNumbers);
  const bracketColorization = useSettingsStore((s) => s.editor.bracketColorization);

  const setTabSize = useSettingsStore((s) => s.setTabSize);
  const setWordWrap = useSettingsStore((s) => s.setWordWrap);
  const setMinimap = useSettingsStore((s) => s.setMinimap);
  const setLineNumbers = useSettingsStore((s) => s.setLineNumbers);
  const setBracketColorization = useSettingsStore((s) => s.setBracketColorization);

  return (
    <div className="space-y-6">
      {/* Code Editing Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Code Editing
        </h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="Tab Size"
            description="Number of spaces for each tab"
          >
            <SelectDropdown<TabSize>
              value={tabSize}
              options={TAB_SIZE_OPTIONS}
              onChange={setTabSize}
            />
          </SettingRow>

          <SettingRow
            label="Word Wrap"
            description="Wrap long lines at viewport edge"
          >
            <ToggleSwitch checked={wordWrap} onChange={setWordWrap} />
          </SettingRow>

          <SettingRow
            label="Minimap"
            description="Show code overview on the right"
          >
            <ToggleSwitch checked={minimap} onChange={setMinimap} />
          </SettingRow>

          <SettingRow
            label="Line Numbers"
            description="Display mode for line numbers"
          >
            <SelectDropdown<LineNumbers>
              value={lineNumbers}
              options={LINE_NUMBER_OPTIONS}
              onChange={setLineNumbers}
            />
          </SettingRow>

          <SettingRow
            label="Bracket Colors"
            description="Colorize matching brackets"
          >
            <ToggleSwitch checked={bracketColorization} onChange={setBracketColorization} />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}
