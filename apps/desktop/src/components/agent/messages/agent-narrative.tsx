import { type FC } from 'react';
import { StreamdownNarrative } from './StreamdownNarrative';
import { LegacyAgentNarrative } from './LegacyAgentNarrative';

export interface AgentNarrativeProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

/**
 * Feature flag: toggle between Streamdown (new) and react-markdown (legacy).
 * Set to `false` to revert to the old renderer for comparison/debugging.
 */
const USE_STREAMDOWN = true;

export const AgentNarrative: FC<AgentNarrativeProps> = (props) => {
  if (USE_STREAMDOWN) {
    return <StreamdownNarrative {...props} />;
  }
  return <LegacyAgentNarrative {...props} />;
};
