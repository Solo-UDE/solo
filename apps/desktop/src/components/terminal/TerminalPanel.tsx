/**
 * TerminalPanel - Integrated terminal panel (placeholder)
 * Will integrate xterm.js when dependency is added
 */

import { useState, useCallback } from 'react';
import { Terminal as TerminalIcon, Plus, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TerminalSession {
  id: string;
  name: string;
  shell: string;
}

interface TerminalPanelProps {
  className?: string;
}

export function TerminalPanel({ className }: TerminalPanelProps) {
  const [sessions, setSessions] = useState<TerminalSession[]>([
    { id: '1', name: 'Terminal 1', shell: 'zsh' },
  ]);
  const [activeSessionId, setActiveSessionId] = useState('1');

  const createSession = useCallback(() => {
    const newId = String(sessions.length + 1);
    setSessions((prev) => [
      ...prev,
      { id: newId, name: `Terminal ${newId}`, shell: 'zsh' },
    ]);
    setActiveSessionId(newId);
  }, [sessions.length]);

  const closeSession = useCallback((id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        return [{ id: '1', name: 'Terminal 1', shell: 'zsh' }];
      }
      return filtered;
    });
    setActiveSessionId((prev) => (prev === id ? sessions[0]?.id ?? '1' : prev));
  }, [sessions]);

  return (
    <div className={cn('flex flex-col h-full bg-bg-base', className)}>
      {/* Terminal tabs */}
      <div className="flex items-center h-9 bg-bg-surface-1 border-b border-border-subtle">
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-none">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={cn(
                'group flex items-center gap-2 px-3 h-9 text-sm',
                'border-r border-border-subtle/50',
                'transition-colors duration-100',
                session.id === activeSessionId
                  ? 'bg-bg-base text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-bg-surface-2'
              )}
              onClick={() => setActiveSessionId(session.id)}
            >
              <TerminalIcon className="w-3.5 h-3.5" />
              <span>{session.name}</span>
              <button
                className={cn(
                  'p-0.5 rounded-sm',
                  'opacity-0 group-hover:opacity-100',
                  'hover:bg-bg-surface-3',
                  'transition-opacity duration-100'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  closeSession(session.id);
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 px-2">
          <button
            className="p-1.5 rounded hover:bg-bg-surface-2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={createSession}
            title="New Terminal"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            className="p-1.5 rounded hover:bg-bg-surface-2 text-muted-foreground hover:text-foreground transition-colors"
            title="Select Shell"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal content (placeholder) */}
      <div className="flex-1 p-4 font-mono text-sm overflow-auto">
        <div className="text-muted-foreground">
          <p className="mb-2">Terminal integration coming soon.</p>
          <p className="text-xs">
            This panel will integrate xterm.js for a full terminal experience.
          </p>
          <div className="mt-4 p-3 rounded bg-bg-surface-1 border border-border-subtle">
            <p className="text-xs text-muted-foreground/70">
              Shortcut: <kbd className="px-1 py-0.5 bg-bg-surface-2 rounded text-[10px]">⌘`</kbd> to toggle terminal
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
