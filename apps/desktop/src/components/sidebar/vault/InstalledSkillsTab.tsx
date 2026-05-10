/**
 * InstalledSkillsTab — shows every skill currently on disk under
 * `~/.solo/skills/`, `{cwd}/.solo/skills/`, and the enabled compatibility
 * adapters. Row actions: uninstall. Future: "View", "Tweak with agent",
 * "Check for update" (phases 3–5).
 */

import type { FC } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useSkillStore } from '@/stores/skillStore';
import { useMarketplaceStore } from '@/stores/marketplaceStore';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { SkillTweakModal } from './SkillTweakModal';
import { VirtualList } from '@/components/ui/virtual-list';

export const InstalledSkillsTab: FC = () => {
  const skills = useSkillStore((s) => s.available);
  const loaded = useSkillStore((s) => s.loaded);
  const loadSkills = useSkillStore((s) => s.loadSkills);
  const uninstall = useMarketplaceStore((s) => s.uninstall);
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const [tweakingSkillId, setTweakingSkillId] = useState<string | null>(null);

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
      <div className="p-5">
        <div className="rounded-[12px] border border-border/60 bg-background/55 p-5">
          <p className="text-[13px] leading-5 text-muted-foreground text-pretty max-w-[58ch]">
            No skills installed yet. The{' '}
            <span className="font-medium text-foreground">ui</span> skill ships with Solo
            and will appear here after the first launch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
    {tweakingSkillId && (
      <SkillTweakModal
        skillId={tweakingSkillId}
        onClose={() => setTweakingSkillId(null)}
        onSaved={() => {
          if (rootPath) void loadSkills(rootPath);
        }}
      />
    )}
    <ul role="list" className="flex flex-col gap-5 p-5">
      {bySource.map(([source, list]) => (
        <li key={source}>
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/65">
            {source.replace('_', ' ')}
          </p>
          <VirtualList
            items={list}
            estimateSize={() => 76}
            overscan={8}
            role="list"
            className="max-h-[420px] rounded-[12px] border border-border/60 bg-background/35"
            itemClassName="border-b border-border/50 last:border-b-0"
            getItemKey={(skill) => `${source}:${skill.name}`}
            testId={`installed-skills-${source}`}
            renderItem={(skill) => (
              <div className="px-3.5 py-3" role="listitem">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">
                      {skill.name}
                    </p>
                    {skill.description && (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground text-pretty">
                        {skill.description}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setTweakingSkillId(skill.name)}
                      className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      Tweak
                    </button>
                    <span aria-hidden="true" className="size-1 rounded-full bg-muted-foreground/30" />
                    <button
                      type="button"
                      onClick={() => {
                        void uninstall(skill.name).then(() => {
                          if (rootPath) void loadSkills(rootPath);
                        });
                      }}
                      className="text-[11px] font-medium text-muted-foreground hover:text-red-500"
                    >
                      Uninstall
                    </button>
                  </div>
                </div>
              </div>
            )}
          />
        </li>
      ))}
    </ul>
    </>
  );
};
