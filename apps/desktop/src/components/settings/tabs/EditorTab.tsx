/**
 * EditorTab - Code editing preferences
 */

import {
  useSettingsStore,
  TAB_SIZE_OPTIONS,
  LINE_NUMBER_OPTIONS,
  CURSOR_STYLE_OPTIONS,
  RENDER_WHITESPACE_OPTIONS,
  type TabSize,
  type LineNumbers,
  type CursorStyle,
  type RenderWhitespace,
} from '../../../stores/settingsStore';
import { SettingRow, SelectDropdown, ToggleSwitch } from '../controls';

export function EditorTab() {
  const tabSize = useSettingsStore((s) => s.editor.tabSize);
  const wordWrap = useSettingsStore((s) => s.editor.wordWrap);
  const minimap = useSettingsStore((s) => s.editor.minimap);
  const lineNumbers = useSettingsStore((s) => s.editor.lineNumbers);
  const bracketColorization = useSettingsStore((s) => s.editor.bracketColorization);
  const insertSpaces = useSettingsStore((s) => s.editor.insertSpaces);
  const cursorStyle = useSettingsStore((s) => s.editor.cursorStyle);
  const renderWhitespace = useSettingsStore((s) => s.editor.renderWhitespace);
  const fontLigatures = useSettingsStore((s) => s.editor.fontLigatures);
  const smoothScrolling = useSettingsStore((s) => s.editor.smoothScrolling);

  const setTabSize = useSettingsStore((s) => s.setTabSize);
  const setWordWrap = useSettingsStore((s) => s.setWordWrap);
  const setMinimap = useSettingsStore((s) => s.setMinimap);
  const setLineNumbers = useSettingsStore((s) => s.setLineNumbers);
  const setBracketColorization = useSettingsStore((s) => s.setBracketColorization);
  const setInsertSpaces = useSettingsStore((s) => s.setInsertSpaces);
  const setEditorCursorStyle = useSettingsStore((s) => s.setEditorCursorStyle);
  const setRenderWhitespace = useSettingsStore((s) => s.setRenderWhitespace);
  const setFontLigatures = useSettingsStore((s) => s.setFontLigatures);
  const setSmoothScrolling = useSettingsStore((s) => s.setSmoothScrolling);

  return (
    <div className="space-y-8">
      {/* Code Editing Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-4">
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
            label="Insert Spaces"
            description="Use spaces instead of tabs"
          >
            <ToggleSwitch checked={insertSpaces} onChange={setInsertSpaces} />
          </SettingRow>

          <SettingRow
            label="Word Wrap"
            description="Wrap long lines at viewport edge"
          >
            <ToggleSwitch checked={wordWrap} onChange={setWordWrap} />
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
            label="Cursor Style"
            description="Shape of the editor cursor"
          >
            <SelectDropdown<CursorStyle>
              value={cursorStyle}
              options={CURSOR_STYLE_OPTIONS}
              onChange={setEditorCursorStyle}
            />
          </SettingRow>
        </div>
      </div>

      {/* Display Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-4">
          Display
        </h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="Minimap"
            description="Show code overview on the right"
          >
            <ToggleSwitch checked={minimap} onChange={setMinimap} />
          </SettingRow>

          <SettingRow
            label="Bracket Colors"
            description="Colorize matching brackets"
          >
            <ToggleSwitch checked={bracketColorization} onChange={setBracketColorization} />
          </SettingRow>

          <SettingRow
            label="Render Whitespace"
            description="Show whitespace characters"
          >
            <SelectDropdown<RenderWhitespace>
              value={renderWhitespace}
              options={RENDER_WHITESPACE_OPTIONS}
              onChange={setRenderWhitespace}
            />
          </SettingRow>

          <SettingRow
            label="Font Ligatures"
            description="Enable programming ligatures"
          >
            <ToggleSwitch checked={fontLigatures} onChange={setFontLigatures} />
          </SettingRow>

          <SettingRow
            label="Smooth Scrolling"
            description="Animate scroll in the editor"
          >
            <ToggleSwitch checked={smoothScrolling} onChange={setSmoothScrolling} />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}
