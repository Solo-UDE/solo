import { useEffect, useState, type FC } from 'react';
import { invoke } from '@tauri-apps/api/core';

export const PlannerNotesSetting: FC = () => {
  const [notes, setNotes] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void invoke<string>('settings_get_planner_notes')
      .then((s) => {
        setNotes(s);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = (next: string) => {
    setNotes(next);
    void invoke('settings_set_planner_notes', { notes: next });
  };

  return (
    <label className="flex flex-col gap-1 p-4 text-[12px] text-muted-foreground">
      Planner notes
      <textarea
        wrap="soft"
        rows={5}
        value={notes}
        onChange={(e) => save(e.target.value)}
        disabled={!loaded}
        placeholder="e.g. I'm focused on shipping the billing dashboard this quarter. Prioritize backend work over UI polish."
        className="resize-y overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1.5 text-[13px] text-foreground focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
      />
      <span className="mt-0.5 text-[10px]">
        Read by the planner on every goal-plan and proactive run. Short is fine.
      </span>
    </label>
  );
};
