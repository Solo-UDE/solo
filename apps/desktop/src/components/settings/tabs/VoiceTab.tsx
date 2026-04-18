import { useEffect, useState } from 'react';
import { voiceApi, onVoiceModelProgress } from '@/lib/tauri/voice';
import { useVoiceStore } from '@/stores/voiceStore';
import type { VoiceTranscriptResult } from '@/bindings/VoiceTranscriptResult';
import { Button } from '@solo/ui';

export function VoiceTab() {
  const enabled = useVoiceStore((s) => s.enabled);
  const setEnabled = useVoiceStore((s) => s.setEnabled);
  const parakeetInstalled = useVoiceStore((s) => s.parakeetInstalled);
  const setParakeetInstalled = useVoiceStore((s) => s.setParakeetInstalled);
  const modelDownload = useVoiceStore((s) => s.modelDownload);
  const setModelDownload = useVoiceStore((s) => s.setModelDownload);

  const [history, setHistory] = useState<VoiceTranscriptResult[]>([]);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    (async () => {
      if (!enabled) return;
      setParakeetInstalled(await voiceApi.parakeetInstalled());
      setHistory(await voiceApi.historyList(50));
    })();
  }, [enabled, setParakeetInstalled]);

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
        <h3 className="text-sm font-semibold mb-2">Voice input</h3>
        <Button onClick={toggleEnable}>{enabled ? 'Disable' : 'Enable'} voice</Button>
      </section>

      {enabled && (
        <>
          <section>
            <h3 className="text-sm font-semibold mb-2">Models</h3>
            <div className="flex items-center gap-3">
              <span>Parakeet TDT 0.6B (int8) —</span>
              <span>{parakeetInstalled ? 'Installed' : 'Not installed'}</span>
              {!parakeetInstalled && (
                <Button disabled={downloading} onClick={downloadParakeet}>
                  {downloading ? 'Downloading…' : 'Download'}
                </Button>
              )}
            </div>
            {modelDownload && (
              <div className="text-xs text-muted-foreground mt-2">
                {Math.round((modelDownload.bytes / Math.max(1, modelDownload.total)) * 100)}%
                ({Math.round(modelDownload.bytes / 1_048_576)} /
                {Math.round(modelDownload.total / 1_048_576)} MB)
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold mb-2">History</h3>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No transcripts yet.</p>
            ) : (
              <ul className="space-y-2 max-h-80 overflow-auto">
                {history.map((r) => (
                  <li key={r.id} className="text-xs border rounded p-2 flex gap-2">
                    <span className="flex-1">{r.formatted}</span>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => navigator.clipboard.writeText(r.formatted)}
                    >Copy</button>
                    <button
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => deleteRow(r.id)}
                    >Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
