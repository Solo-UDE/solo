import { Lightning, Brain, ShieldCheck } from '@phosphor-icons/react';
import React from 'react';

import { cn } from '../../../lib/utils';
import { toolbarButtonBase } from './toolbar-button-class';

export type Mode = 'fast' | 'planning' | 'accept';

const MODE_ORDER: Mode[] = ['fast', 'planning', 'accept'];

const MODE_CONFIG: Record<Mode, { label: string; icon: typeof Lightning }> = {
  fast: {
    label: 'Fast',
    icon: Lightning,
  },
  planning: {
    label: 'Planning',
    icon: Brain,
  },
  accept: {
    label: 'Accept',
    icon: ShieldCheck,
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
        value === 'planning' && 'text-primary bg-primary/10',
        value === 'accept' && 'text-green-600 dark:text-green-400 bg-green-500/10',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <Icon className="h-3.5 w-3.5" weight={value !== 'fast' ? 'fill' : 'regular'} />
      <span className="text-xs font-medium">{config.label}</span>
    </button>
  );
};
