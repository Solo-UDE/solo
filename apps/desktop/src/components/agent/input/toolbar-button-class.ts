/**
 * Shared toolbar button styles for the chat input area
 */

import { cn } from '@/lib/utils';

export const toolbarButtonBase = cn(
  'inline-flex shrink-0 items-center gap-1.5',
  'h-[30px] px-2.5 rounded-[8px]',
  'bg-transparent text-muted-foreground',
  'hover:bg-muted/60 hover:text-foreground',
  'active:scale-[0.97]',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30',
  'transition-[transform,background-color,color] duration-200',
);

export const toolbarButtonIconOnly = cn(
  toolbarButtonBase,
  'w-[30px] px-0 justify-center',
);
