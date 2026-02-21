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
      className={cn(
        'group flex items-center p-1 rounded-lg',
        'hover:bg-foreground/[0.06]',
        'transition-[background-color,color] duration-150',
        active && 'glow-active',
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
          'group-hover:max-w-[5rem] group-hover:opacity-100 group-hover:ml-1.5',
          'transition-[max-width,opacity,margin] duration-400',
          'ease-[cubic-bezier(0.16,1,0.3,1)]',
          'text-xs font-medium',
          active ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {label}
      </span>
    </button>
  );
}
