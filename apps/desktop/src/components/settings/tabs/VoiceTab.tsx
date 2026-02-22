/**
 * VoiceTab - ElevenLabs voice settings (API key, language, TTS preferences)
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { SettingRow } from '../controls';
import { PasswordInput } from '../controls';
import { SelectDropdown } from '../controls';
import { ToggleSwitch } from '../controls';
import { setApiKey, hasApiKey, clearApiKey } from '@/lib/tauri/elevenlabs';
import { useElevenLabsStore } from '@/stores/elevenlabsStore';

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ar', label: 'Arabic' },
];

export function VoiceTab() {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();
  const [language, setLanguage] = useState('en');
  const [autoPlay, setAutoPlay] = useState(false);

  const hasKey = useElevenLabsStore((s) => s.hasApiKey);
  const storeSetHasKey = useElevenLabsStore((s) => s.setHasApiKey);

  // Check if API key is already set on mount
  useEffect(() => {
    hasApiKey()
      .then((has) => {
        storeSetHasKey(has);
        if (has) {
          setApiKeyInput('••••••••••••••••');
        }
      })
      .catch(() => {});
  }, [storeSetHasKey]);

  const handleSaveApiKey = useCallback(async (value: string) => {
    setApiKeyInput(value);
    setError(undefined);
    setSaved(false);

    // Don't save masked placeholder
    if (!value || value === '••••••••••••••••') return;

    // Auto-save when the key looks complete (ElevenLabs keys are 32 chars)
    if (value.length >= 20) {
      setSaving(true);
      try {
        await setApiKey(value);
        storeSetHasKey(true);
        setSaved(true);
        setSaving(false);
        // Mask the key after saving
        setTimeout(() => {
          setApiKeyInput('••••••••••••••••');
        }, 1500);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSaving(false);
      }
    }
  }, [storeSetHasKey]);

  const handleClearApiKey = useCallback(async () => {
    setApiKeyInput('');
    setSaved(false);
    setError(undefined);
    try {
      await clearApiKey();
      storeSetHasKey(false);
    } catch {
      // Ignore
    }
  }, [storeSetHasKey]);

  return (
    <div className="space-y-8">
      {/* API Key Section */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-4">ElevenLabs</h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="API Key"
            description="Required for voice input (STT) and text-to-speech (TTS). Get your key at elevenlabs.io"
          >
            <div className="flex items-center gap-2">
              <PasswordInput
                value={apiKeyInput}
                onChange={handleSaveApiKey}
                onClear={handleClearApiKey}
                placeholder="Enter ElevenLabs API key..."
                disabled={saving}
              />
              {saved && (
                <CheckCircle weight="fill" className="w-4 h-4 text-green-500 shrink-0" />
              )}
              {error && (
                <WarningCircle weight="fill" className="w-4 h-4 text-destructive shrink-0" />
              )}
            </div>
          </SettingRow>

          {/* Status indicator */}
          <SettingRow
            label="Status"
            description="Voice features require a valid API key"
          >
            <div className="flex items-center gap-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${hasKey ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
              <span className={hasKey ? 'text-foreground' : 'text-muted-foreground'}>
                {hasKey ? 'Connected' : 'Not configured'}
              </span>
            </div>
          </SettingRow>
        </div>
      </div>

      {/* Speech-to-Text Settings */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-4">Speech to Text</h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="Language"
            description="Primary language for voice recognition"
          >
            <SelectDropdown
              value={language}
              options={LANGUAGE_OPTIONS}
              onChange={setLanguage}
            />
          </SettingRow>
        </div>
      </div>

      {/* Text-to-Speech Settings */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-4">Text to Speech</h3>
        <div className="divide-y divide-border">
          <SettingRow
            label="Auto-play responses"
            description="Automatically read agent responses aloud"
          >
            <ToggleSwitch
              checked={autoPlay}
              onChange={setAutoPlay}
            />
          </SettingRow>
        </div>
      </div>
    </div>
  );
}
