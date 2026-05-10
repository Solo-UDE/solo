import { useEffect, useState } from 'react';
import { voiceApi, onVoiceModelProgress } from '@/lib/tauri/voice';
import { useVoiceStore } from '@/stores/voiceStore';
import type { VoiceTranscriptResult } from '@/bindings/VoiceTranscriptResult';
import { Button } from '@solo/ui';
import { VirtualList } from '../../ui/virtual-list';

export function VoiceTab() {
  const enabled = useVoiceStore((s) => s.enabled);
  const setEnabled = useVoiceStore((s) => s.setEnabled);
  const parakeetInstalled = useVoiceStore((s) => s.parakeetInstalled);
  const setParakeetInstalled = useVoiceStore((s) => s.setParakeetInstalled);
  const modelDownload = useVoiceStore((s) => s.modelDownload);
  const setModelDownload = useVoiceStore((s) => s.setModelDownload);
  const shortcuts = useVoiceStore((s) => s.shortcuts);
  const setShortcuts = useVoiceStore((s) => s.setShortcuts);
  const permissions = useVoiceStore((s) => s.permissions);
  const setPermissions = useVoiceStore((s) => s.setPermissions);

  const [history, setHistory] = useState<VoiceTranscriptResult[]>([]);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    (async () => {
      if (!enabled) return;
      setParakeetInstalled(await voiceApi.parakeetInstalled());
      setHistory(await voiceApi.historyList(50));
      setShortcuts(await voiceApi.getShortcuts());
      setPermissions(await voiceApi.checkPermissions());
    })();
  }, [enabled, setParakeetInstalled, setShortcuts, setPermissions]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await onVoiceModelProgress((p) =>
        setModelDownload({ bytes: Number(p.bytes), total: Number(p.total) }),
      );
    })();
    return () => unlisten?.();
  }, [setModelDownload]);

  async function toggleEnable() {
    if (!enabled) {
      await voiceApi.enable();
      setEnabled(true);
      setParakeetInstalled(await voiceApi.parakeetInstalled());
    } else {
      setEnabled(false);
    }
  }

  async function downloadParakeet() {
    setDownloading(true);
    try {
      await voiceApi.downloadParakeet();
      setParakeetInstalled(true);
    } finally {
      setDownloading(false);
      setModelDownload(null);
    }
  }

  async function deleteRow(id: string) {
    await voiceApi.historyDelete(id);
    setHistory(await voiceApi.historyList(50));
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Voice input</h3>
        <Button onClick={toggleEnable}>{enabled ? 'Disable' : 'Enable'} voice</Button>
      </section>

      {enabled && (
        <>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Models</h3>
            <div className="flex items-center gap-3">
              <span>Parakeet TDT 0.6B (int8) —</span>
              <span>{parakeetInstalled ? 'Installed' : 'Not installed'}</span>
              {!parakeetInstalled && (
                <Button disabled={downloading} onClick={downloadParakeet}>
                  {downloading ? 'Downloading…' : 'Download'}
                </Button>
              )}
            </div>
            {downloading && (
              <ModelDownloadProgress
                bytes={modelDownload ? Number(modelDownload.bytes) : 0}
                total={modelDownload ? Number(modelDownload.total) : 0}
              />
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">History</h3>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No transcripts yet.</p>
            ) : (
              <VirtualList
                items={history}
                estimateSize={() => 52}
                overscan={8}
                role="list"
                className="max-h-80"
                itemClassName="pb-2"
                getItemKey={(r) => r.id}
                testId="voice-history"
                renderItem={(r) => (
                  <div className="text-xs border rounded p-2 flex gap-2" role="listitem">
                    <span className="flex-1">{r.formatted}</span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => navigator.clipboard.writeText(r.formatted)}
                    >Copy</button>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => deleteRow(r.id)}
                    >Delete</button>
                  </div>
                )}
              />
            )}
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Shortcuts</h3>
            <div className="grid grid-cols-[140px_1fr] gap-2 items-center">
              {([
                ['Dictation PTT', 'dictation_ptt'],
                ['Dispatch PTT', 'dispatch_ptt'],
                ['Cancel', 'cancel'],
              ] as const).map(([label, key]) => (
                <div key={key} className="contents">
                  <span className="text-xs">{label}</span>
                  <ShortcutRecorder
                    value={shortcuts[key]}
                    onChange={async (next) => {
                      const updated = { ...shortcuts, [key]: next };
                      setShortcuts(updated);
                      await voiceApi.setShortcuts(updated);
                    }}
                  />
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">Permissions</h3>
            <ul className="space-y-1">
              {([
                ['Microphone', 'microphone'],
                ['Input Monitoring', 'input_monitoring'],
                ['Accessibility', 'accessibility'],
              ] as const).map(([label, key]) => (
                <li key={key} className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${permissions[key] ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="flex-1 text-xs">{label}</span>
                  {!permissions[key] && (
                    <Button onClick={async () => {
                      const which = key === 'input_monitoring' ? 'input-monitoring' : (key as 'microphone' | 'accessibility');
                      const next = await voiceApi.requestPermission(which);
                      setPermissions(next);
                    }}>
                      Grant
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function ModelDownloadProgress({ bytes, total }: { bytes: number; total: number }) {
  const hasTotal = total > 0;
  const pct = hasTotal ? Math.min(100, Math.round((bytes / total) * 100)) : 0;
  const mb = (n: number) => (n / 1_048_576).toFixed(1);
  return (
    <div className="mt-3 space-y-1.5" role="status" aria-live="polite">
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full bg-primary transition-[width] duration-200 ease-out ${hasTotal ? '' : 'animate-pulse w-1/3'}`}
          style={hasTotal ? { width: `${pct}%` } : undefined}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>{hasTotal ? `${pct}%` : 'Connecting…'}</span>
        <span>
          {hasTotal ? `${mb(bytes)} / ${mb(total)} MB` : bytes > 0 ? `${mb(bytes)} MB` : ''}
        </span>
      </div>
    </div>
  );
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [listening, setListening] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setListening(true)}
      onKeyDown={(e) => {
        if (!listening) return;
        e.preventDefault();
        const parts: string[] = [];
        if (e.ctrlKey) parts.push('ctrl');
        if (e.altKey) parts.push('alt');
        if (e.shiftKey) parts.push('shift');
        if (e.metaKey) parts.push('cmd');
        const name = e.key === ' ' ? 'space' : e.key === 'Escape' ? 'escape' : e.key.toLowerCase();
        if (name.length > 0 && !['control', 'alt', 'shift', 'meta', 'fn'].includes(name)) {
          parts.push(name);
          onChange(parts.join('+'));
          setListening(false);
        }
      }}
      onBlur={() => setListening(false)}
      className="text-xs border rounded px-2 py-1 text-left"
    >
      {listening ? 'Press a shortcut…' : value}
    </button>
  );
}
