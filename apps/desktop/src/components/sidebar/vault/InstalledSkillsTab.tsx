/**
 * InstalledSkillsTab — shows every skill currently on disk under
 * `~/.solo/skills/`, `{cwd}/.solo/skills/`, and the enabled compatibility
 * adapters. Row actions: uninstall. Future: "View", "Tweak with agent",
 * "Check for update" (phases 3–5).
 */

import type { FC } from 'react';
import { useEffect, useMemo } from 'react';
import { useSkillStore } from '@/stores/skillStore';
import { useMarketplaceStore } from '@/stores/marketplaceStore';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';

export const InstalledSkillsTab: FC = () => {
  const skills = useSkillStore((s) => s.available);
  const loaded = useSkillStore((s) => s.loaded);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const uninstall = useMarketplaceStore((s) => s.uninstall);
  const rootPath = useFileExplorerStore((s) => s.rootPath);

  useEffect(() => {
    if (!loaded && rootPath) {
      void loadSkills(rootPath);
    }
  }, [loaded, rootPath, loadSkills]);

  const bySource = useMemo(() => {
    const groups = new Map<string, typeof skills>();
    for (const skill of skills) {
      const arr = groups.get(skill.source) ?? [];
      arr.push(skill);
      groups.set(skill.source, arr);
    }
    return Array.from(groups.entries());
  }, [skills]);

  if (!skills.length) {
    return (
      <p className="px-4 py-6 text-xs text-muted-foreground">
        No skills installed yet. The <span className="font-medium">ui</span> skill ships
        with Solo and will appear here after the first launch.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3 p-3">
      {bySource.map(([source, list]) => (
        <li key={source}>
          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
            {source.replace('_', ' ')}
          </p>
          <ul className="space-y-1">
            {list.map((skill) => (
              <li
                key={`${source}:${skill.name}`}
                className="rounded-[10px] border border-border/60 bg-card/40 px-2.5 py-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{skill.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      void uninstall(skill.name).then(() => {
                        if (rootPath) void loadSkills(rootPath);
                      });
                    }}
                    className="text-[10px] text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    Uninstall
                  </button>
                </div>
                {skill.description && (
                  <p className="mt-1 line-clamp-2 text-muted-foreground">
                    {skill.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
};
