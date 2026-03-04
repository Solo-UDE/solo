import type { RenderBlock } from '@/components/agent/messageAdapter';

export interface ProgressPhase {
  id: string;
  label: string;
  status: 'active' | 'completed';
  /** Short content preview (~80 chars) for context */
  preview?: string;
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
  AskUserQuestion: 'Asking question',
};

function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? `Using ${toolName}`;
}

/** Extract a short preview string from a tool's input */
function toolPreview(toolName: string, toolInput: Record<string, unknown>): string | undefined {
  const name = toolName.toLowerCase();
  let raw: string | undefined;

  if (name === 'bash') raw = toolInput['command'] as string | undefined;
  else if (['read', 'write', 'edit'].includes(name)) raw = toolInput['file_path'] as string | undefined;
  else if (['glob', 'grep'].includes(name)) raw = toolInput['pattern'] as string | undefined;
  else if (name === 'websearch') raw = toolInput['query'] as string | undefined;
  else if (name === 'webfetch') raw = toolInput['url'] as string | undefined;
  else if (name === 'task') raw = toolInput['description'] as string | undefined;

  if (!raw) return undefined;
  return raw.length > 80 ? raw.slice(0, 77) + '...' : raw;
}

/** Extract a short preview from narrative content */
function narrativePreview(content: string): string | undefined {
  // Take first meaningful line, skip blank lines
  const line = content.split('\n').find((l) => l.trim().length > 0)?.trim();
  if (!line) return undefined;
  return line.length > 80 ? line.slice(0, 77) + '...' : line;
}

// ---------------------------------------------------------------------------
// Interleaved Timeline — progress indicators mixed inline with content blocks
// ---------------------------------------------------------------------------

export type TimelineEntry =
  | { kind: 'progress'; phase: ProgressPhase }
  | { kind: 'content'; block: RenderBlock; blockIndex: number };

/**
 * Build a chronological timeline that interleaves progress indicators with
 * content blocks. During streaming, progress phases appear inline before the
 * content they describe. Completed messages return content-only entries.
 *
 * Pure function — safe to call on every render.
 */
export function buildInterleavedTimeline(
  blocks: RenderBlock[],
  isStreaming: boolean,
): TimelineEntry[] {
  // Completed messages — no progress indicators, just content
  if (!isStreaming) {
    return blocks.map((block, i) => ({ kind: 'content' as const, block, blockIndex: i }));
  }

  const timeline: TimelineEntry[] = [];
  let phaseIndex = 0;

  // No blocks yet — still connecting
  if (blocks.length === 0) {
    timeline.push({
      kind: 'progress',
      phase: { id: `phase-${phaseIndex}`, label: 'Connecting', status: 'active' },
    });
    return timeline;
  }

  // Blocks exist — connecting is done
  timeline.push({
    kind: 'progress',
    phase: { id: `phase-${phaseIndex++}`, label: 'Connecting', status: 'completed' },
  });

  let lastProgressLabel = '';

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    switch (block.type) {
      case 'thinking': {
        // ThinkingBox IS the visual indicator — no separate progress phase needed
        timeline.push({ kind: 'content', block, blockIndex: i });
        lastProgressLabel = 'Reasoning';
        break;
      }
      case 'narrative': {
        // Emit "Responding" progress phase (skip if previous was also "Responding")
        if (lastProgressLabel !== 'Responding') {
          timeline.push({
            kind: 'progress',
            phase: {
              id: `phase-${phaseIndex++}`,
              label: 'Responding',
              status: 'active',
              preview: narrativePreview(block.content),
            },
          });
        }
        lastProgressLabel = 'Responding';
        // Emit the content block
        timeline.push({ kind: 'content', block, blockIndex: i });
        break;
      }
      case 'toolCall': {
        const label = toolLabel(block.toolName);
        timeline.push({
          kind: 'progress',
          phase: {
            id: `phase-${phaseIndex++}`,
            label,
            status: block.status === 'running' ? 'active' : 'completed',
            preview: toolPreview(block.toolName, block.toolInput),
          },
        });
        lastProgressLabel = label;
        // Emit the content block (tool card)
        timeline.push({ kind: 'content', block, blockIndex: i });
        break;
      }
      case 'approval': {
        const label = toolLabel(block.toolName);
        timeline.push({
          kind: 'progress',
          phase: {
            id: `phase-${phaseIndex++}`,
            label,
            status: 'active',
          },
        });
        lastProgressLabel = label;
        // Emit the approval card
        timeline.push({ kind: 'content', block, blockIndex: i });
        break;
      }
    }
  }

  // Trailing gap — if last block is completed and not a narrative/thinking,
  // append an active "Reasoning" spinner to indicate the model is thinking
  const lastBlock = blocks[blocks.length - 1];
  if (lastBlock) {
    const isLastActive =
      (lastBlock.type === 'narrative') ||
      (lastBlock.type === 'thinking' && lastBlock.isStreaming) ||
      (lastBlock.type === 'toolCall' && lastBlock.status === 'running') ||
      (lastBlock.type === 'approval');
    if (!isLastActive) {
      timeline.push({
        kind: 'progress',
        phase: { id: `phase-${phaseIndex++}`, label: 'Reasoning', status: 'active' },
      });
    }
  }

  // Post-process: only the LAST active progress phase should show animated dots.
  // Earlier active phases (e.g. multiple "Responding..." entries) become completed.
  let foundLastActive = false;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const entry = timeline[i];
    if (entry.kind === 'progress' && entry.phase.status === 'active') {
      if (!foundLastActive) {
        foundLastActive = true;
      } else {
        entry.phase.status = 'completed';
      }
    }
  }

  return timeline;
}

// ---------------------------------------------------------------------------
// Legacy progress phases — stacked list at top of message (kept for non-block path)
// ---------------------------------------------------------------------------

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
          preview: toolPreview(block.toolName, block.toolInput),
        });
        break;
      }
      case 'narrative': {
        const prev = phases[phases.length - 1];
        if (prev && prev.label === 'Responding') {
          // Merge adjacent narrative blocks — update preview to latest
          prev.preview = narrativePreview(block.content);
        } else {
          phases.push({
            id: `phase-${phaseIndex++}`,
            label: 'Responding',
            status: 'active',
            preview: narrativePreview(block.content),
          });
        }
        break;
      }
      case 'approval': {
        // Show a progress phase for tools awaiting user input
        const approvalLabel = toolLabel(block.toolName);
        phases.push({
          id: `phase-${phaseIndex++}`,
          label: approvalLabel,
          status: 'active',
        });
        break;
      }
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
