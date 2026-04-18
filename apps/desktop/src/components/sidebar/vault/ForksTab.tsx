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
      <div className="p-5">
        <div className="rounded-[12px] border border-border/60 bg-background/55 p-5">
          <p className="text-[13px] font-medium text-foreground">No forked skills.</p>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground/80 text-pretty max-w-[58ch]">
            When you tweak an installed skill with the agent, it appears here so you can
            see upstream updates relative to your local edits.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul
      role="list"
      className="m-5 divide-y divide-border/50 overflow-hidden rounded-[12px] border border-border/60 bg-background/35"
    >
      {forked.map((skill) => (
        <li key={skill.name} className="px-3.5 py-3">
          <p className="text-[13px] font-medium text-foreground">{skill.name}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground text-pretty">
            Locally tweaked from upstream.
          </p>
        </li>
      ))}
    </ul>
  );
};
