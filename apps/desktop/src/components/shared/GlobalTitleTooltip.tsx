import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../lib/utils';

interface TooltipState {
  text: string;
  x: number;
  y: number;
  side: 'top' | 'bottom';
  align: 'start' | 'center' | 'end';
}

const DATA_TITLE_ATTR = 'data-solo-title-tooltip';

const findTitleElement = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(`[title], [${DATA_TITLE_ATTR}]`);
};

const getStoredTitle = (element: HTMLElement) =>
  element.getAttribute('title') ?? element.getAttribute(DATA_TITLE_ATTR) ?? '';

const getTooltipPosition = (element: HTMLElement): Omit<TooltipState, 'text'> => {
  const rect = element.getBoundingClientRect();
  const side = rect.top < 36 ? 'bottom' : 'top';
  const centerX = rect.left + rect.width / 2;
  const align = centerX > window.innerWidth - 160 ? 'end' : centerX < 160 ? 'start' : 'center';
  const x = align === 'end'
    ? Math.min(rect.right, window.innerWidth - 16)
    : align === 'start'
      ? Math.max(rect.left, 16)
      : centerX;
  const y = side === 'top' ? rect.top - 8 : rect.bottom + 8;

  return { x, y, side, align };
};

export function GlobalTitleTooltip() {
  const activeElementRef = useRef<HTMLElement | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    const restoreTitle = (element: HTMLElement | null) => {
      if (!element) return;
      const title = element.getAttribute(DATA_TITLE_ATTR);
      if (title && !element.hasAttribute('title')) {
        element.setAttribute('title', title);
      }
    };

    const hide = () => {
      restoreTitle(activeElementRef.current);
      activeElementRef.current = null;
      setTooltip(null);
    };

    const show = (element: HTMLElement) => {
      const text = getStoredTitle(element).trim();
      if (!text || element.closest('[data-disable-global-title-tooltip]')) return;

      element.setAttribute(DATA_TITLE_ATTR, text);
      element.removeAttribute('title');
      activeElementRef.current = element;
      setTooltip({ text, ...getTooltipPosition(element) });
    };

    const refresh = () => {
      const element = activeElementRef.current;
      if (!element || !element.isConnected) {
        hide();
        return;
      }

      const text = getStoredTitle(element).trim();
      if (!text) {
        hide();
        return;
      }

      setTooltip({ text, ...getTooltipPosition(element) });
    };

    const handlePointerOver = (event: PointerEvent) => {
      const element = findTitleElement(event.target);
      if (!element || element === activeElementRef.current) return;
      hide();
      show(element);
    };

    const handlePointerOut = (event: PointerEvent) => {
      const element = activeElementRef.current;
      if (!element) return;
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && element.contains(relatedTarget)) return;
      hide();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const element = findTitleElement(event.target);
      if (!element || element === activeElementRef.current) return;
      hide();
      show(element);
    };

    const handleFocusOut = () => hide();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', handlePointerOver);
    document.addEventListener('pointerout', handlePointerOut);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);

    return () => {
      restoreTitle(activeElementRef.current);
      document.removeEventListener('pointerover', handlePointerOver);
      document.removeEventListener('pointerout', handlePointerOut);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, []);

  if (!tooltip) return null;

  const translateX = tooltip.align === 'end' ? '-100%' : tooltip.align === 'start' ? '0' : '-50%';
  const translateY = tooltip.side === 'top' ? '-100%' : '0';

  return createPortal(
    <div
      role="tooltip"
      className={cn(
        'pointer-events-none fixed z-[2147483647] max-w-[min(28rem,calc(100vw-2rem))]',
        'will-change-[left,top]',
      )}
      style={{
        left: tooltip.x,
        top: tooltip.y,
        transform: `translate(${translateX}, ${translateY})`,
      }}
    >
      <div
        className={cn(
          'truncate rounded-full bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground',
          'shadow-md ring-1 ring-black/5 dark:ring-white/5',
          'origin-[var(--solo-tooltip-origin)] animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]',
        )}
        style={{
          ['--solo-tooltip-origin' as string]: tooltip.side === 'top' ? 'bottom' : 'top',
        }}
      >
        {tooltip.text}
      </div>
    </div>,
    document.body,
  );
}
