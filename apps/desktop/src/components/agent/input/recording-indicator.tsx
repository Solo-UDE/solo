/**
 * Pulsing ring animation for voice recording state.
 * Renders as an absolutely-positioned overlay behind the voice button.
 */

import React from 'react';

interface RecordingIndicatorProps {
  active: boolean;
}

export const RecordingIndicator: React.FC<RecordingIndicatorProps> = ({ active }) => {
  if (!active) return null;

  return (
    <span className="absolute inset-0 rounded-[8px] animate-pulse-ring pointer-events-none" />
  );
};
