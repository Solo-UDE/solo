/**
 * First-launch prompt offering to pull in skills users already authored for
 * Claude Code or Codex. Appears when:
 *
 *   1. `~/.solo/skills/` is empty (no prior Solo skills), AND
 *   2. The onboarding flag hasn't been set yet, AND
 *   3. At least one importable skill exists elsewhere.
 *
 * The user picks Keep / Copy / Symlink / Skip. Any choice sets the flag so
 * we never ask again. Adapters stay on by default regardless — this dialog
 * is about whether to make copies in `~/.solo/`, not whether to surface
 * external skills.
 */

import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';

import { useSkillStore } from '../../stores/skillStore';
import { useFileExplorerStore } from '../../stores/fileExplorerStore';

import type { FC } from 'react';
import type { OnboardingImportMode } from '../../bindings/OnboardingImportMode';

const OPTIONS: Array<{
  mode: OnboardingImportMode;
  title: string;
  blurb: string;
}> = [
  {
    mode: 'read_only',
    title: 'Keep in place',
    blurb: 'Surface external skills as-is. Nothing is copied — if you change them in Claude, Solo picks up the change.',
  },
  {
    mode: 'copy',
    title: 'Copy into Solo',
    blurb: 'Take a snapshot into ~/.solo/skills/. Edits in Solo won\'t affect your Claude files and vice-versa.',
  },
  {
    mode: 'symlink',
    title: 'Symlink into Solo',
    blurb: 'Link each skill folder into ~/.solo/skills/. Edits flow both ways — Solo stays in sync with Claude.',
  },
];

export const SkillsOnboardingDialog: FC = () => {
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const onboarding = useSkillStore((s) => s.onboarding);
  const checkOnboarding = useSkillStore((s) => s.checkOnboarding);
  const applyOnboarding = useSkillStore((s) => s.applyOnboarding);
  const dismissOnboarding = useSkillStore((s) => s.dismissOnboarding);

  const [busy, setBusy] = useState<OnboardingImportMode | 'dismiss' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!rootPath) return;
    if (onboarding === null) {
      void checkOnboarding(rootPath);
    }
  }, [rootPath, onboarding, checkOnboarding]);

  if (!rootPath) return null;
  if (!onboarding?.shouldPrompt) return null;

  const handleApply = async (mode: OnboardingImportMode) => {
    setBusy(mode);
    try {
      const imported = await applyOnboarding(rootPath, mode);
      if (mode === 'read_only') {
        setFeedback('Solo will read your existing skills in place.');
      } else {
        setFeedback(`Imported ${imported} skill${imported === 1 ? '' : 's'}.`);
      }
      setTimeout(() => setFeedback(null), 1500);
    } catch (err) {
      console.error('[SkillsOnboarding] apply failed:', err);
      setFeedback('Import failed — check the console.');
    } finally {
      setBusy(null);
    }
  };

  const handleDismiss = async () => {
    setBusy('dismiss');
    try {
      await dismissOnboarding(rootPath);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="max-w-lg w-full mx-4 rounded-xl bg-popover shadow-2xl p-6 animate-in fade-in slide-in-from-bottom-4 duration-200">
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 p-2 rounded-lg bg-primary/10">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              We found {onboarding.importableCount} skill{onboarding.importableCount === 1 ? '' : 's'} from other tools
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Solo can use them right now. Pick how you'd like them stored — you can change this later in Settings.
            </p>
          </div>
        </div>

        <div className="space-y-2 mb-4">
          {OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              onClick={() => handleApply(opt.mode)}
              disabled={busy !== null}
              className="w-full text-left p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{opt.title}</span>
                {busy === opt.mode && (
                  <span className="text-xs text-muted-foreground">Working…</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{opt.blurb}</p>
            </button>
          ))}
        </div>

        {feedback && (
          <p className="text-xs text-muted-foreground text-center mb-2">{feedback}</p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border/30">
          <button
            onClick={handleDismiss}
            disabled={busy !== null}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            type="button"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
};
