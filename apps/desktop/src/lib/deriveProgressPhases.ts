import type { RenderBlock } from '@/components/agent/messageAdapter';

export interface ProgressPhase {
  id: string;
  label: string;
  status: 'active' | 'completed';
}

export const TOOL_LABELS: Record<string, string> = {
  Bash: 'Running command',
  Read: 'Reading file',
  Write: 'Writing code',
  Edit: 'Writing code',
  Glob: 'Searching codebase',
  Grep: 'Searching codebase',
  WebSearch: 'Searching the web',
  WebFetch: 'Searching the web',
  Task: 'Running sub-agent',
};

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? `Using ${toolName}`;
}

/**
 * Derive a list of semantic progress phases from the ordered render blocks.
 * Pure function — no side effects, safe to call on every render.
 */
export function deriveProgressPhases(
  blocks: RenderBlock[],
  isStreaming: boolean,
): ProgressPhase[] {
  if (!isStreaming) return [];

  const phases: ProgressPhase[] = [];
  let phaseIndex = 0;

  // No blocks yet — still connecting
  if (blocks.length === 0) {
    return [{ id: `phase-${phaseIndex}`, label: 'Connecting', status: 'active' }];
  }

  // Blocks exist — connecting is done
  phases.push({ id: `phase-${phaseIndex++}`, label: 'Connecting', status: 'completed' });

  for (const block of blocks) {
    switch (block.type) {
      case 'thinking': {
        const prev = phases[phases.length - 1];
        if (prev && prev.label === 'Reasoning') {
          // Merge adjacent thinking blocks — keep the existing phase
          // (status will be overwritten below if needed)
        } else {
          phases.push({ id: `phase-${phaseIndex++}`, label: 'Reasoning', status: 'completed' });
        }
        // Active if this thinking block is still streaming
        if (block.isStreaming) {
          phases[phases.length - 1].status = 'active';
        }
        break;
      }
      case 'toolCall': {
        const label = toolLabel(block.toolName);
        phases.push({
          id: `phase-${phaseIndex++}`,
          label,
          status: block.status === 'running' ? 'active' : 'completed',
        });
        break;
      }
      case 'narrative': {
        const prev = phases[phases.length - 1];
        if (prev && prev.label === 'Responding') {
          // Merge adjacent narrative blocks
        } else {
          phases.push({ id: `phase-${phaseIndex++}`, label: 'Responding', status: 'active' });
        }
        break;
      }
      case 'approval':
        // Approval cards render separately — skip
        break;
    }
  }

  // If streaming and the last phase is completed (and not "Responding"),
  // the model is likely thinking before the next event arrives.
  const last = phases[phases.length - 1];
  if (last && last.status === 'completed' && last.label !== 'Responding') {
    phases.push({ id: `phase-${phaseIndex++}`, label: 'Reasoning', status: 'active' });
  }

  return phases;
}
