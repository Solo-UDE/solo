import { Brain, Bug, CircleDot, ShieldCheck } from 'lucide-react';
import React from 'react';

import type { PermissionMode } from '../../../bindings';
import { cn } from '../../../lib/utils';
import { toolbarButtonBase } from './toolbar-button-class';

/**
 * Session mode. Mirrors `PermissionMode` from the Rust protocol.
 *
 *   - `default` — no overlay; strictly honors allow/ask/deny rules.
 *   - `plan`    — read-only; plan markdown is written to `.solo/plans/`.
 *   - `accept`  — bypass prompts (like Claude Code's `--dangerously-skip-permissions`);
 *                 destructive tier still prompts.
 *   - `debug`   — captures the goal at session start; periodic review questions.
 */
export type Mode = PermissionMode;

const MODE_ORDER: Mode[] = ['default', 'plan', 'accept', 'debug'];

const MODE_CONFIG: Record<
  Mode,
  {
    label: string;
    icon: typeof Brain;
    tone: string | null;
  }
> = {
  default: {
    label: 'Default',
    icon: CircleDot,
    tone: null,
  },
  plan: {
    label: 'Plan',
    icon: Brain,
    tone: 'text-primary bg-primary/10',
  },
  accept: {
    label: 'Accept',
    icon: ShieldCheck,
    tone: 'text-green-600 dark:text-green-400 bg-green-500/10',
  },
  debug: {
    label: 'Debug',
    icon: Bug,
    tone: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
  },
};

export interface ModeSelectorProps {
  value: Mode;
  onChange: (mode: Mode) => void;
  disabled?: boolean;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const config = MODE_CONFIG[value];
  const Icon = config.icon;

  const cycleMode = () => {
    const currentIndex = MODE_ORDER.indexOf(value);
    const nextIndex = (currentIndex + 1) % MODE_ORDER.length;
    onChange(MODE_ORDER[nextIndex]);
  };

  return (
    <button
      type="button"
      onClick={cycleMode}
      disabled={disabled}
      title={`${config.label} — click to cycle (⇧⇥)`}
      className={cn(
        toolbarButtonBase,
        config.tone,
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="text-xs font-medium">{config.label}</span>
    </button>
  );
};
