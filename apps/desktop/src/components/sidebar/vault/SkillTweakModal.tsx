/**
 * SkillTweakModal — direct-edit view for an installed skill's AGENTS.md.
 *
 * Phase 5 MVP: manual markdown editor. The "tweak with agent" upgrade
 * (preload skill into a fresh agent session, converse, persist edits)
 * lives on top of this — same save path, same `.solo-origin.json.modified`
 * flip.
 */

import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { readInstalledSkill, writeInstalledSkill } from '@/lib/tauri/marketplace';

interface SkillTweakModalProps {
  skillId: string;
  onClose: () => void;
  onSaved: () => void;
}

export const SkillTweakModal: FC<SkillTweakModalProps> = ({ skillId, onClose, onSaved }) => {
  const [content, setContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readInstalledSkill(skillId)
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  const handleSave = async (): Promise<void> => {
    if (content === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await writeInstalledSkill(skillId, content);
      onSaved();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-[min(720px,90vh)] w-[min(860px,94vw)] flex-col rounded-[14px] border border-border/70 bg-card p-5 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Tweak {skillId}</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Edit the skill's AGENTS.md directly. Saving flips the skill to a local fork so
              upstream updates become opt-in.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {loadError && (
          <p className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            Failed to load skill: {loadError}
          </p>
        )}

        {content === null && !loadError && (
          <p className="text-xs text-muted-foreground">Loading skill…</p>
        )}

        {content !== null && (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-md border border-border/60 bg-background/40 p-3 font-mono text-xs leading-relaxed outline-none focus:border-border"
          />
        )}

        {saveError && (
          <p className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            Save failed: {saveError}
          </p>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border/60 bg-card/60 px-3 py-1 text-xs hover:bg-card/80"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || content === null || content === ''}
            className="rounded-md border border-border/60 bg-foreground/90 px-3 py-1 text-xs text-background hover:bg-foreground disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save as fork'}
          </button>
        </div>
      </div>
    </div>
  );
};
