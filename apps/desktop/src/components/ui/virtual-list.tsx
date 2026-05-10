import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useRef, type ReactNode, type UIEventHandler } from 'react';

import { cn } from '@/lib/utils';

import type { VirtualItem } from '@tanstack/react-virtual';

interface VirtualListProps<T> {
  readonly items: readonly T[];
  readonly renderItem: (item: T, index: number, virtualItem: VirtualItem) => ReactNode;
  readonly getItemKey?: (item: T, index: number) => string | number;
  readonly estimateSize: () => number;
  readonly className?: string;
  readonly contentClassName?: string;
  readonly itemClassName?: string | ((item: T, index: number) => string | undefined);
  readonly overscan?: number;
  readonly measureElement?: boolean;
  readonly horizontal?: boolean;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly testId?: string;
  readonly emptyState?: ReactNode;
  readonly scrollToIndex?: number | null;
  readonly onScroll?: UIEventHandler<HTMLDivElement>;
  readonly scrollElementRef?: (node: HTMLDivElement | null) => void;
}

export function VirtualList<T>({
  items,
  renderItem,
  getItemKey,
  estimateSize,
  className,
  contentClassName,
  itemClassName,
  overscan = 8,
  measureElement = true,
  horizontal = false,
  role,
  ariaLabel,
  testId,
  emptyState,
  scrollToIndex,
  onScroll,
  scrollElementRef,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setScrollElement = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      scrollElementRef?.(node);
    },
    [scrollElementRef],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan,
    horizontal,
  });
  const virtualItems = virtualizer.getVirtualItems();

  useEffect(() => {
    if (scrollToIndex == null || scrollToIndex < 0 || scrollToIndex >= items.length) return;
    virtualizer.scrollToIndex(scrollToIndex, { align: 'auto' });
  }, [items.length, scrollToIndex, virtualizer]);

  if (items.length === 0 && emptyState) {
    return (
      <div
        className={className}
        data-virtualized-list={testId ?? true}
        data-total-items={0}
        data-rendered-items={0}
      >
        {emptyState}
      </div>
    );
  }

  return (
    <div
      ref={setScrollElement}
      className={cn('overflow-auto', className)}
      role={role}
      aria-label={ariaLabel}
      onScroll={onScroll}
      data-virtualized-list={testId ?? true}
      data-total-items={items.length}
      data-rendered-items={virtualItems.length}
    >
      <div
        className={contentClassName}
        style={
          horizontal
            ? {
                width: virtualizer.getTotalSize(),
                height: '100%',
                position: 'relative',
              }
            : {
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }
        }
      >
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (item === undefined) return null;
          const classNameForItem =
            typeof itemClassName === 'function'
              ? itemClassName(item, virtualItem.index)
              : itemClassName;

          return (
            <div
              key={getItemKey?.(item, virtualItem.index) ?? virtualItem.key}
              data-index={virtualItem.index}
              data-virtual-row
              ref={measureElement ? virtualizer.measureElement : undefined}
              className={classNameForItem}
              style={
                horizontal
                  ? {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      height: '100%',
                      transform: `translateX(${virtualItem.start}px)`,
                    }
                  : {
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }
              }
            >
              {renderItem(item, virtualItem.index, virtualItem)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface VirtualTextLinesProps {
  readonly lines: readonly string[];
  readonly renderLine?: (line: string, index: number) => ReactNode;
  readonly estimateSize?: () => number;
  readonly className?: string;
  readonly contentClassName?: string;
  readonly lineClassName?: string;
  readonly overscan?: number;
  readonly testId?: string;
}

export function VirtualTextLines({
  lines,
  renderLine,
  estimateSize = () => 20,
  className,
  contentClassName,
  lineClassName,
  overscan = 12,
  testId,
}: VirtualTextLinesProps) {
  return (
    <VirtualList
      items={lines}
      estimateSize={estimateSize}
      overscan={overscan}
      measureElement={false}
      className={className}
      contentClassName={contentClassName}
      itemClassName={lineClassName}
      getItemKey={(_line, index) => index}
      testId={testId}
      renderItem={(line, index) =>
        renderLine ? renderLine(line, index) : line || '\u00A0'
      }
    />
  );
}
