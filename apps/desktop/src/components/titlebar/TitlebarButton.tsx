import { type ReactNode, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

interface TitlebarButtonProps extends ComponentPropsWithoutRef<'button'> {
  icon: ReactNode;
  label: string;
  active?: boolean;
}

export function TitlebarButton({
  icon,
  label,
  active = false,
  className,
  ...props
}: TitlebarButtonProps) {
  return (
    <button
      data-tauri-drag-region={false}
      className={cn(
        'group inline-flex h-8 items-center rounded-full px-2',
        'bg-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground',
        'transition-[background-color,color,transform] duration-150 active:scale-[0.97]',
        active && 'bg-background/50',
        className,
      )}
      {...props}
    >
      <span className="shrink-0 flex items-center justify-center">
        {icon}
      </span>
      <span
        className={cn(
          'overflow-hidden whitespace-nowrap',
          'max-w-0 opacity-0 ml-0',
          'group-hover:max-w-[6rem] group-hover:opacity-100 group-hover:ml-1.5',
          'transition-[max-width,opacity,margin] duration-400',
          'ease-[cubic-bezier(0.16,1,0.3,1)]',
          'text-[11px] font-medium tracking-[0.01em]',
          active ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
    </button>
  );
}
