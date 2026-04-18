/**
 * ForksTab — skills the user has tweaked locally after installing from the
 * registry. A fork is detected via `.solo-origin.json.modified = true`.
 *
 * The flag is written by the agent tweak flow (Phase 5). Until that ships,
 * this tab stays empty by design — that's correct behavior, not a bug.
 */

import type { FC } from 'react';
import { useMemo } from 'react';
import { useSkillStore } from '@/stores/skillStore';

export const ForksTab: FC = () => {
  const skills = useSkillStore((s) => s.available);

  // `skillStore.available` does not yet carry the `modified` / origin fields
  // — Phase 5 extends it. Until then the list is always empty; we keep the
  // tab so the UI shape matches the final design.
  const forked = useMemo(
    () => skills.filter((s) => (s as { modified?: boolean }).modified === true),
    [skills],
  );

  if (!forked.length) {
    return (
      <div className="px-4 py-6 text-xs text-muted-foreground">
        <p>No forked skills.</p>
        <p className="mt-2 text-[10px] text-muted-foreground/70">
          When you tweak an installed skill with the agent, it appears here so you can see
          upstream updates relative to your local edits.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-1 p-3">
      {forked.map((skill) => (
        <li
          key={skill.name}
          className="rounded-[10px] border border-border/60 bg-card/40 px-2.5 py-2 text-xs"
        >
          <span className="font-medium text-foreground">{skill.name}</span>
          <p className="mt-1 text-muted-foreground">Locally tweaked from upstream.</p>
        </li>
      ))}
    </ul>
  );
};
