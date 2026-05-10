/**
 * SkillsTab — manage the skill sources Solo reads from and browse what's loaded.
 *
 * Solo's own `.solo/skills/` directories are always scanned. The four toggles
 * here enable/disable compatibility adapters so users coming from Claude Code
 * or Codex keep their skills without copying files. Changes persist at user
 * scope via `skills_set_imports`.
 */

import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, RotateCcw, Zap } from 'lucide-react';

import { SettingRow, ToggleSwitch } from '../controls';
import { useSkillStore } from '../../../stores/skillStore';
import { useSoloSettingsStore } from '../../../stores/soloSettingsStore';
import { useFileExplorerStore } from '../../../stores/fileExplorerStore';
import { skillsSetImports, skillsOnboardingReset } from '../../../lib/tauri/skills';
import { revealInFinder } from '../../../lib/tauri/fs';
import { VirtualList } from '../../ui/virtual-list';

import type { FC } from 'react';
import type { SkillSource } from '../../../bindings/SkillSource';

const SOURCE_META: Record<
  SkillSource,
  { label: string; tone: 'native' | 'claude' | 'codex' }
> = {
  user: { label: 'Solo · User', tone: 'native' },
  project: { label: 'Solo · Project', tone: 'native' },
  claude_user: { label: 'Claude · User', tone: 'claude' },
  claude_plugin: { label: 'Claude · Plugin', tone: 'claude' },
  claude_project: { label: 'Claude · Project', tone: 'claude' },
  codex: { label: 'Codex', tone: 'codex' },
};

const TONE_CLASS: Record<'native' | 'claude' | 'codex', string> = {
  native: 'text-primary bg-primary/10',
  claude: 'text-orange-500 bg-orange-500/10',
  codex: 'text-sky-500 bg-sky-500/10',
};

export const SkillsTab: FC = () => {
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const settings = useSoloSettingsStore((s) => s.settings);
  const loadSettings = useSoloSettingsStore((s) => s.load);

  const available = useSkillStore((s) => s.available);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const checkOnboarding = useSkillStore((s) => s.checkOnboarding);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config = settings?.skills;

  useEffect(() => {
    if (!rootPath) return;
    if (!settings) {
      void loadSettings(rootPath);
    }
    if (!available.length) {
      void loadSkills(rootPath);
    }
  }, [rootPath, settings, available.length, loadSettings, loadSkills]);

  const grouped = useMemo(() => {
    const groups: Record<SkillSource, typeof available> = {
      user: [],
      project: [],
      claude_user: [],
      claude_project: [],
      claude_plugin: [],
      codex: [],
    };
    for (const s of available) groups[s.source].push(s);
    return groups;
  }, [available]);

  const setToggle = async (
    key: 'claudeUser' | 'claudePlugins' | 'claudeProject' | 'codex',
    value: boolean,
  ) => {
    if (!rootPath) return;
    setBusy(key);
    setError(null);
    try {
      await skillsSetImports(rootPath, { [key]: value });
      await loadSettings(rootPath);
      await loadSkills(rootPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const rescan = async () => {
    if (!rootPath) return;
    setBusy('rescan');
    try {
      await loadSkills(rootPath);
    } finally {
      setBusy(null);
    }
  };

  const replayOnboarding = async () => {
    if (!rootPath) return;
    setBusy('replay');
    try {
      await skillsOnboardingReset(rootPath);
      await checkOnboarding(rootPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const openFolder = async (filePath: string) => {
    try {
      await revealInFinder(filePath);
    } catch (err) {
      console.warn('[SkillsTab] reveal failed:', err);
    }
  };

  if (!config) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading settings…
      </div>
    );
  }

  const totalImported =
    grouped.claude_user.length +
    grouped.claude_project.length +
    grouped.claude_plugin.length +
    grouped.codex.length;

  return (
    <div className="space-y-8">
      {/* Sources */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Sources
        </h3>
        <p className="text-xs text-muted-foreground/80 mb-4 -mt-2">
          Solo always scans <code className="font-mono text-foreground/80">~/.solo/skills/</code> and <code className="font-mono text-foreground/80">&lt;workspace&gt;/.solo/skills/</code>. These toggles control compatibility adapters so skills from other tools show up without copying files.
        </p>

        <div className="divide-y divide-border">
          <SettingRow
            label="Claude Code · personal"
            description="Scan ~/.claude/skills/"
          >
            <ToggleSwitch
              checked={config.importClaudeUser}
              onChange={(v) => setToggle('claudeUser', v)}
              disabled={busy === 'claudeUser'}
            />
          </SettingRow>

          <SettingRow
            label="Claude Code · plugins"
            description="Scan installed plugins from ~/.claude/plugins/installed_plugins.json"
          >
            <ToggleSwitch
              checked={config.importClaudePlugins}
              onChange={(v) => setToggle('claudePlugins', v)}
              disabled={busy === 'claudePlugins'}
            />
          </SettingRow>

          <SettingRow
            label="Claude Code · project"
            description="Walk up from the workspace looking for .claude/skills/ folders"
          >
            <ToggleSwitch
              checked={config.importClaudeProject}
              onChange={(v) => setToggle('claudeProject', v)}
              disabled={busy === 'claudeProject'}
            />
          </SettingRow>

          <SettingRow
            label="Codex"
            description="Scan ~/.codex/skills/ (harmless if the directory does not exist)"
          >
            <ToggleSwitch
              checked={config.importCodex}
              onChange={(v) => setToggle('codex', v)}
              disabled={busy === 'codex'}
            />
          </SettingRow>
        </div>

        {error && (
          <p className="mt-3 text-xs text-destructive">Failed to update: {error}</p>
        )}

        <button
          type="button"
          onClick={replayOnboarding}
          disabled={busy === 'replay'}
          className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
        >
          <RotateCcw className="w-3 h-3" />
          Show import dialog again
        </button>
      </div>

      {/* Summary */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
          Loaded Skills
        </h3>
        <div className="flex items-center gap-3 mb-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-primary" />
            <strong className="text-foreground">{available.length}</strong> total
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span>
            <strong className="text-foreground">{grouped.user.length + grouped.project.length}</strong> native
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span>
            <strong className="text-foreground">{totalImported}</strong> imported
          </span>
          <button
            type="button"
            onClick={rescan}
            disabled={busy === 'rescan'}
            className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3" />
            Rescan
          </button>
        </div>

        {(Object.keys(grouped) as SkillSource[]).map((source) => {
          const skills = grouped[source];
          if (skills.length === 0) return null;
          const meta = SOURCE_META[source];
          return (
            <div key={source} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${TONE_CLASS[meta.tone]}`}
                >
                  {meta.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {skills.length} skill{skills.length === 1 ? '' : 's'}
                </span>
              </div>
              <VirtualList
                items={skills}
                estimateSize={() => 52}
                overscan={8}
                className="max-h-[360px] rounded-lg border border-border/50"
                itemClassName="border-b border-border/40 last:border-b-0"
                getItemKey={(s) => `${s.source}:${s.name}`}
                testId={`settings-skills-${source}`}
                renderItem={(s) => (
                  <div
                    className="flex items-start gap-3 px-3 py-2 hover:bg-muted/30 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">{s.name}</div>
                      {s.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {s.description}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => openFolder(s.file_path)}
                      className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
                      title="Reveal in Finder"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              />
            </div>
          );
        })}

        {available.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            No skills found. Drop a <code className="font-mono">SKILL.md</code> into <code className="font-mono">~/.solo/skills/&lt;name&gt;/</code> or enable an adapter above.
          </p>
        )}
      </div>
    </div>
  );
};
