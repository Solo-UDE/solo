/**
 * FilesTab - File handling preferences
 */

import { useSettingsStore, AUTOSAVE_OPTIONS, type AutosaveDelay } from '../../../stores/settingsStore';
import { SettingRow, SelectDropdown, ToggleSwitch } from '../controls';

export function FilesTab() {
  const autosaveDelay = useSettingsStore((s) => s.files.autosaveDelay);
  const showHiddenFiles = useSettingsStore((s) => s.files.showHiddenFiles);

  const setAutosaveDelay = useSettingsStore((s) => s.setAutosaveDelay);
  const setShowHiddenFiles = useSettingsStore((s) => s.setShowHiddenFiles);

  return (
    <div className="space-y-6">
      {/* File Handling Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
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
            label="Show Hidden Files"
            description="Display dotfiles in the file explorer"
          >
            <ToggleSwitch checked={showHiddenFiles} onChange={setShowHiddenFiles} />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}
