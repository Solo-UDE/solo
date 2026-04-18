/**
 * FilesTab - File handling preferences
 */

import {
  useSettingsStore,
  AUTOSAVE_OPTIONS,
  LINE_ENDING_OPTIONS,
  type AutosaveDelay,
  type LineEnding,
} from '../../../stores/settingsStore';
import { SettingRow, SelectDropdown, ToggleSwitch } from '../controls';

export function FilesTab() {
  const autosaveDelay = useSettingsStore((s) => s.files.autosaveDelay);
  const showHiddenFiles = useSettingsStore((s) => s.files.showHiddenFiles);
  const trimTrailingWhitespace = useSettingsStore((s) => s.files.trimTrailingWhitespace);
  const insertFinalNewline = useSettingsStore((s) => s.files.insertFinalNewline);
  const defaultLineEnding = useSettingsStore((s) => s.files.defaultLineEnding);
  const excludePatterns = useSettingsStore((s) => s.files.excludePatterns);

  const setAutosaveDelay = useSettingsStore((s) => s.setAutosaveDelay);
  const setShowHiddenFiles = useSettingsStore((s) => s.setShowHiddenFiles);
  const setTrimTrailingWhitespace = useSettingsStore((s) => s.setTrimTrailingWhitespace);
  const setInsertFinalNewline = useSettingsStore((s) => s.setInsertFinalNewline);
  const setDefaultLineEnding = useSettingsStore((s) => s.setDefaultLineEnding);
  const setExcludePatterns = useSettingsStore((s) => s.setExcludePatterns);

  return (
    <div className="space-y-8">
      {/* File Handling Section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          File Handling
        </h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="Autosave Delay"
            description="Files save when switching tabs or windows"
          >
            <SelectDropdown<AutosaveDelay>
              value={autosaveDelay}
              options={AUTOSAVE_OPTIONS}
              onChange={setAutosaveDelay}
            />
          </SettingRow>

          <SettingRow
            label="Trim Trailing Whitespace"
            description="Remove trailing spaces on save"
          >
            <ToggleSwitch checked={trimTrailingWhitespace} onChange={setTrimTrailingWhitespace} />
          </SettingRow>

          <SettingRow
            label="Insert Final Newline"
            description="Ensure file ends with a newline on save"
          >
            <ToggleSwitch checked={insertFinalNewline} onChange={setInsertFinalNewline} />
          </SettingRow>

          <SettingRow
            label="Default Line Endings"
            description="Line ending style for new files"
          >
            <SelectDropdown<LineEnding>
              value={defaultLineEnding}
              options={LINE_ENDING_OPTIONS}
              onChange={setDefaultLineEnding}
            />
          </SettingRow>
        </div>
      </div>

      {/* Explorer Section */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Explorer
        </h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="Show Hidden Files"
            description="Display dotfiles in the file explorer"
          >
            <ToggleSwitch checked={showHiddenFiles} onChange={setShowHiddenFiles} />
          </SettingRow>

          <div className="py-4">
            <div className="text-sm font-medium text-foreground mb-1">Exclude Patterns</div>
            <div className="text-xs text-muted-foreground mb-3">
              Comma-separated list of folders/files to hide from the explorer
            </div>
            <input
              type="text"
              value={excludePatterns}
              onChange={(e) => setExcludePatterns(e.target.value)}
              placeholder="node_modules, .git, target, dist"
              className="w-full px-3 py-2 bg-muted/40 rounded-lg text-sm text-foreground font-mono placeholder:text-muted-foreground/50 focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
