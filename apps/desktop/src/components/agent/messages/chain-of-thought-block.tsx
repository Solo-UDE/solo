import * as Collapsible from '@radix-ui/react-collapsible';
import { Brain, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';

import { StreamdownNarrative } from './StreamdownNarrative';

import type { FC } from 'react';

export interface ChainOfThoughtBlockProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export const ChainOfThoughtBlock: FC<ChainOfThoughtBlockProps> = ({
  content,
  isStreaming = false,
  className = '',
}) => {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger asChild>
        <button
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors duration-150 group ${className}`}
        >
          <Brain className="w-3.5 h-3.5 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-xs font-medium text-muted-foreground/70">Thinking</span>
          <CaretRight
            className={`w-3 h-3 text-muted-foreground/50 ml-auto transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          />
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-up-1 data-[state=open]:slide-down-1">
        <div
          className="px-3 py-2 mt-1 rounded-md bg-muted/20 border-l-2 border-muted-foreground/20"
          style={{ borderColor: 'var(--border-tool)' }}
        >
          <StreamdownNarrative
            content={content}
            isStreaming={isStreaming}
            className="text-muted-foreground/80 text-xs leading-relaxed"
          />
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
};

/**
 * Extract thinking blocks from content.
 * Returns { thinking: string[], cleaned: string }
 */
export function extractThinkingBlocks(content: string): {
  thinking: string[];
  cleaned: string;
} {
  const thinkingBlocks: string[] = [];
  const cleaned = content.replace(
    /<thinking>([\s\S]*?)<\/thinking>/g,
    (_match, inner: string) => {
      thinkingBlocks.push(inner.trim());
      return '';
    }
  );

  return {
    thinking: thinkingBlocks,
    cleaned: cleaned.trim(),
  };
}
