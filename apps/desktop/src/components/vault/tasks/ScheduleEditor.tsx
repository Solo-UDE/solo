import { useEffect, useState, type FC } from 'react';
import { cn } from '@/lib/utils';
import { tasksApi, type Schedule, type PresetKind } from '@/lib/tauri/tasks';
import { SelectDropdown } from '@/components/settings/controls/SelectDropdown';

interface Props {
  readonly value: Schedule | null;
  readonly onChange: (next: Schedule | null) => void;
}

type Mode = 'none' | 'preset' | 'cron' | 'oneshot';

export const ScheduleEditor: FC<Props> = ({ value, onChange }) => {
  const mode: Mode = !value
    ? 'none'
    : value.kind === 'preset'
    ? 'preset'
    : value.kind === 'cron'
    ? 'cron'
    : value.kind === 'one_shot'
    ? 'oneshot'
    : 'none';

  const [preview, setPreview] = useState<number[]>([]);
  useEffect(() => {
    if (!value) { setPreview([]); return; }
    void tasksApi.schedulePreview(value).then(setPreview).catch(() => setPreview([]));
  }, [value]);

  const setMode = (m: Mode) => {
    if (m === 'none') onChange(null);
    else if (m === 'preset') onChange({ kind: 'preset', data: { kind: 'daily', hour: 9, minute: 0, weekday: null, next_fire: BigInt(0) } });
    else if (m === 'cron') onChange({ kind: 'cron', data: { expr: '0 9 * * *', next_fire: BigInt(0) } });
    else onChange({ kind: 'one_shot', data: { at: BigInt(Date.now() + 60_000) } });
  };

  return (
    <div className="flex flex-col gap-4 p-4 text-[12px]">
      <fieldset className="flex gap-2">
        {(['none', 'preset', 'cron', 'oneshot'] as const).map((m) => (
          <label key={m} className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-border/40 px-2.5 py-1 transition-all duration-200',
            mode === m ? 'bg-card shadow-[0_4px_12px_-8px_rgba(0,0,0,0.25)]' : 'bg-background hover:bg-muted/40',
          )}>
            <input
              type="radio" name="sched-mode" value={m} checked={mode === m}
              onChange={() => setMode(m)}
              className="accent-foreground"
            />
            <span className="capitalize">{m === 'oneshot' ? 'One-shot' : m}</span>
          </label>
        ))}
      </fieldset>

      {mode === 'preset' && value?.kind === 'preset' && (
        <PresetFields value={value.data} onChange={(data) => onChange({ kind: 'preset', data })} />
      )}
      {mode === 'cron' && value?.kind === 'cron' && (
        <CronFields value={value.data} onChange={(data) => onChange({ kind: 'cron', data })} />
      )}
      {mode === 'oneshot' && value?.kind === 'one_shot' && (
        <OneShotFields value={value.data} onChange={(data) => onChange({ kind: 'one_shot', data })} />
      )}

      {preview.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">Next 5 fires</div>
          <ul className="flex flex-col gap-0.5 rounded-[10px] border border-border/40 bg-card/95 backdrop-blur-sm p-2 text-[11px] shadow-[0_4px_12px_-8px_rgba(0,0,0,0.2)]">
            {preview.map((ms, i) => (
              <li key={i} className="tabular-nums text-foreground">{new Date(Number(ms)).toLocaleString()}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const PresetFields: FC<{
  value: Extract<Schedule, { kind: 'preset' }>['data'],
  onChange: (data: Extract<Schedule, { kind: 'preset' }>['data']) => void,
}> = ({ value, onChange }) => (
  <div className="grid grid-cols-2 gap-2">
    <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">Kind
      <SelectDropdown
        value={value.kind}
        options={[
          { label: 'Hourly', value: 'hourly' as PresetKind },
          { label: 'Daily', value: 'daily' as PresetKind },
          { label: 'Weekly', value: 'weekly' as PresetKind },
          { label: 'Monthly', value: 'monthly' as PresetKind },
        ]}
        onChange={(v) => onChange({ ...value, kind: v })}
      />
    </label>
    <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">At (UTC)
      <div className="flex gap-1">
        <input
          type="number" min={0} max={23}
          value={value.hour}
          onChange={(e) => onChange({ ...value, hour: Math.max(0, Math.min(23, Number(e.target.value) || 0)) })}
          className="w-16 rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1 text-[12px] text-foreground tabular-nums focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
        />
        <span className="self-center">:</span>
        <input
          type="number" min={0} max={59}
          value={value.minute}
          onChange={(e) => onChange({ ...value, minute: Math.max(0, Math.min(59, Number(e.target.value) || 0)) })}
          className="w-16 rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1 text-[12px] text-foreground tabular-nums focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
        />
      </div>
    </label>
    {value.kind === 'weekly' && (
      <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground col-span-2">Weekday
        <SelectDropdown
          value={value.weekday ?? 0}
          options={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((wd, idx) => ({ label: wd, value: idx }))}
          onChange={(v) => onChange({ ...value, weekday: v })}
        />
      </label>
    )}
  </div>
);

const CronFields: FC<{
  value: Extract<Schedule, { kind: 'cron' }>['data'],
  onChange: (data: Extract<Schedule, { kind: 'cron' }>['data']) => void,
}> = ({ value, onChange }) => (
  <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">Cron expression (UTC, 5-field)
    <input
      value={value.expr}
      onChange={(e) => onChange({ ...value, expr: e.target.value })}
      placeholder="0 9 * * *"
      className="rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1 font-mono text-[12px] text-foreground focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
    />
    <span className="text-[10px]">Examples: <code>0 9 * * *</code> daily 9am · <code>*/5 * * * *</code> every 5 min · <code>0 0 * * 1</code> Mondays midnight</span>
  </label>
);

const OneShotFields: FC<{
  value: Extract<Schedule, { kind: 'one_shot' }>['data'],
  onChange: (data: Extract<Schedule, { kind: 'one_shot' }>['data']) => void,
}> = ({ value, onChange }) => {
  const iso = new Date(Number(value.at)).toISOString().slice(0, 16);
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">Fire at
      <input
        type="datetime-local"
        value={iso}
        onChange={(e) => onChange({ ...value, at: BigInt(new Date(e.target.value).getTime()) })}
        className="rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1 text-[12px] text-foreground focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
      />
    </label>
  );
};
