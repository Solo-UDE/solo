import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRightIcon, CircleIcon, CheckIcon } from '@radix-ui/react-icons';
import { ListChecks, Loader2 } from 'lucide-react';

import type { FC } from 'react';
import type { Message } from '@/stores/agentStore';

interface TodoItem {
  content?: string;
  status?: string;
}

interface StickyTodoOverlayProps {
  readonly messages: Message[];
  /** Reports the rendered overlay height (incl. its bottom margin) to the parent
      so the message feed can reserve matching space and avoid occlusion. 0 when hidden. */
  readonly onHeightChange?: (heightPx: number) => void;
}

/**
 * Codex-style sticky tasks pill, anchored just above the chat input.
 *
 * Reads the latest TodoWrite / TaskCreate / TaskUpdate / TaskList tool call
 * across visible messages and renders a translucent overlay that summarises
 * progress ("0 out of 3 tasks completed") and expands to show each item.
 *
 * Hidden when there are no tasks, or when every task is already completed.
 */
export const StickyTodoOverlay: FC<StickyTodoOverlayProps> = ({ messages, onHeightChange }) => {
  const [expanded, setExpanded] = useState(true);
  const pillRef = useRef<HTMLDivElement>(null);

  const { todos, sourceInterrupted } = useMemo<{ todos: TodoItem[]; sourceInterrupted: boolean }>(() => {
    // Walk newest -> oldest, find the most recent message with a tasks-related
    // tool call. The latest TodoWrite/TaskList wins (full snapshot of state).
    // Track whether the owning message was interrupted so we can hide stale
    // state after an abort — any `in_progress` todo there will never land.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || msg.role !== 'assistant' || !msg.toolCalls?.length) continue;
      // Scan tool calls newest-first within the message too
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        const tc = msg.toolCalls[j];
        if (!tc) continue;
        const name = tc.name.toLowerCase();
        if (name === 'todowrite' || name === 'tasklist') {
          const arr = (tc.input as Record<string, unknown> | undefined)?.['todos'];
          if (Array.isArray(arr)) {
            return {
              todos: arr.map((it) => (typeof it === 'object' && it !== null ? (it as TodoItem) : { content: String(it) })),
              sourceInterrupted: !!msg.isInterrupted,
            };
          }
          // tasklist returns todos in output JSON
          if (name === 'tasklist' && tc.output) {
            try {
              const parsed = JSON.parse(tc.output);
              if (Array.isArray(parsed)) {
                return {
                  todos: parsed.map((t: Record<string, unknown>) => ({
                    content: (t['subject'] as string) || (t['description'] as string),
                    status: t['status'] as string,
                  })),
                  sourceInterrupted: !!msg.isInterrupted,
                };
              }
            } catch { /* ignore */ }
          }
        }
      }
    }
    return { todos: [], sourceInterrupted: false };
  }, [messages]);

  const { completed, total, anyRunning } = useMemo(() => {
    let c = 0;
    let r = false;
    for (const t of todos) {
      const s = (t.status ?? '').toLowerCase();
      if (s === 'completed' || s === 'done') c += 1;
      if (s === 'in_progress' || s === 'running') r = true;
    }
    return { completed: c, total: todos.length, anyRunning: r };
  }, [todos]);

  // Hide when nothing to show, fully complete, or the turn that produced
  // these tasks was aborted — in the abort case the `in_progress` spinner
  // would keep turning forever against stale state.
  const hidden = total === 0 || completed === total || sourceInterrupted;

  // Measure rendered height (incl. surrounding padding) so the message feed
  // can reserve matching space and never tuck streamed content underneath.
  useEffect(() => {
    if (hidden) {
      onHeightChange?.(0);
      return;
    }
    const el = pillRef.current;
    if (!el || !onHeightChange) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      onHeightChange(Math.ceil(r.height));
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hidden, expanded, onHeightChange, total]);

  if (hidden) return null;

  return (
    <div ref={pillRef} className="pointer-events-none absolute inset-x-0 bottom-full z-20 px-4 pb-2">
      <div
        className="pointer-events-auto mx-auto max-w-3xl rounded-xl border border-border/40 px-3 py-2 shadow-lg backdrop-blur-md"
        style={{ background: 'oklch(from var(--popover) l c h / 0.85)' }}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 text-xs text-foreground/85 hover:text-foreground transition-colors"
          aria-expanded={expanded}
        >
          {anyRunning
            ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
            : <ListChecks className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <span className="font-medium">
            {completed} out of {total} tasks completed
          </span>
          <div className="flex-1" />
          <ChevronRightIcon
            width={12} height={12}
            className={`text-muted-foreground/60 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
          />
        </button>

        {expanded ? (
          <ol className="mt-2 space-y-1">
            {todos.map((t, i) => {
              const s = (t.status ?? '').toLowerCase();
              const isDone = s === 'completed' || s === 'done';
              const isRunning = s === 'in_progress' || s === 'running';
              return (
                <li key={`todo-${String(i)}`} className="flex items-start gap-2 text-[12px]">
                  <span className="mt-0.5 shrink-0">
                    {isDone ? (
                      <CheckIcon width={12} height={12} className="text-success" />
                    ) : isRunning ? (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    ) : (
                      <CircleIcon width={12} height={12} className="text-muted-foreground/60" />
                    )}
                  </span>
                  <span className="text-muted-foreground/80 shrink-0 tabular-nums">{i + 1}.</span>
                  <span className={isDone ? 'text-muted-foreground line-through' : 'text-foreground/90'}>
                    {t.content ?? ''}
                  </span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </div>
  );
};
