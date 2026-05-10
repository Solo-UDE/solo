import { useVirtualizer } from '@tanstack/react-virtual';
import { IconButton, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@solo/ui';
import { Archive, ArrowDown, MessageSquare } from 'lucide-react';
import { useCallback, useRef, useEffect, useState } from 'react';

import { MessageSection } from './message-section';

import type { Message } from './message-section';
import type { FC } from 'react';

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 50;
const AUTO_SCROLL_NEW_MESSAGE_THRESHOLD_PX = 100;
const USER_SCROLL_UP_DELTA_PX = 1;
const SELECTION_POPOVER_WIDTH_PX = 240;

interface SelectionActionState {
  text: string;
  x: number;
  y: number;
}

export interface MessageGroup {
  id: string;
  messages: Message[];
}

export interface MessageFeedProps {
  messageGroups: MessageGroup[];
  autoScroll?: boolean;
  isStreaming?: boolean;
  onToolApproval?: (toolCallId: string, approved: boolean) => void;
  onAnswerQuestion?: (requestId: string, answers: Record<string, string>) => void;
  onAddSelectionToChat?: (text: string) => void;
  onAddSelectionToVault?: (text: string) => Promise<void> | void;
  /** Reserved space below the message list. Used so floating overlays
      anchored above the input (e.g. sticky tasks pill) never occlude the
      latest streamed content. Auto-scroll lands below this padding. */
  bottomReservePx?: number;
  className?: string;
}

export const MessageFeed: FC<MessageFeedProps> = ({
  messageGroups,
  autoScroll = true,
  isStreaming = false,
  onToolApproval,
  onAnswerQuestion,
  onAddSelectionToChat,
  onAddSelectionToVault,
  bottomReservePx = 0,
  className = '',
}) => {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const [showFollowLatest, setShowFollowLatest] = useState(false);
  const [selectionAction, setSelectionAction] = useState<SelectionActionState | null>(null);
  const [isSavingSelection, setIsSavingSelection] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const selectionPopoverRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScroll = useRef(autoScroll);
  const lastScrollTopRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  // Track which groups have already been mounted (to avoid re-animation)
  const mountedGroupsRef = useRef(new Set<string>());
  // Track the batch of newly mounted groups for staggered animation
  const mountBatchRef = useRef(0);

  const virtualizer = useVirtualizer({
    count: messageGroups.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 200,
    overscan: 5,
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (shouldAutoScroll.current && scrollElement) {
      const { scrollHeight, clientHeight } = scrollElement;
      const isNearBottom =
        scrollHeight - clientHeight - scrollElement.scrollTop < AUTO_SCROLL_NEW_MESSAGE_THRESHOLD_PX;

      if (isNearBottom || messageGroups.length === 1) {
        virtualizer.scrollToIndex(messageGroups.length - 1, {
          align: 'end',
          behavior: 'smooth',
        });
      }
    }
  }, [messageGroups.length, virtualizer, scrollElement]);

  // Track if user is manually scrolling
  useEffect(() => {
    if (!scrollElement) return;

    lastScrollTopRef.current = scrollElement.scrollTop;

    const handleScroll = (): void => {
      const { scrollHeight, clientHeight, scrollTop } = scrollElement;
      const isScrollingUp = scrollTop < lastScrollTopRef.current - USER_SCROLL_UP_DELTA_PX;
      const isScrollingDown = scrollTop > lastScrollTopRef.current + USER_SCROLL_UP_DELTA_PX;
      const isAtBottom = scrollHeight - clientHeight - scrollTop < AUTO_SCROLL_BOTTOM_THRESHOLD_PX;

      if (isScrollingUp) {
        shouldAutoScroll.current = false;
        setShowFollowLatest(isStreaming && autoScroll);
      } else if (isAtBottom && (shouldAutoScroll.current || isScrollingDown)) {
        shouldAutoScroll.current = autoScroll;
        setShowFollowLatest(false);
      }

      lastScrollTopRef.current = scrollTop;
    };

    const handleWheel = (event: WheelEvent): void => {
      if (event.deltaY < 0) {
        shouldAutoScroll.current = false;
        setShowFollowLatest(isStreaming && autoScroll);
      } else if (event.deltaY > 0) {
        const { scrollHeight, clientHeight, scrollTop } = scrollElement;
        const isAtBottom = scrollHeight - clientHeight - scrollTop < AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
        if (isAtBottom) {
          shouldAutoScroll.current = autoScroll;
          setShowFollowLatest(false);
        }
      }
    };

    const handleTouchStart = (event: TouchEvent): void => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent): void => {
      const startY = touchStartYRef.current;
      const currentY = event.touches[0]?.clientY;
      if (startY === null || currentY === undefined) return;
      if (currentY > startY + USER_SCROLL_UP_DELTA_PX) {
        shouldAutoScroll.current = false;
        setShowFollowLatest(isStreaming && autoScroll);
      }
    };

    scrollElement.addEventListener('scroll', handleScroll);
    scrollElement.addEventListener('wheel', handleWheel, { passive: true });
    scrollElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    scrollElement.addEventListener('touchmove', handleTouchMove, { passive: true });
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
      scrollElement.removeEventListener('wheel', handleWheel);
      scrollElement.removeEventListener('touchstart', handleTouchStart);
      scrollElement.removeEventListener('touchmove', handleTouchMove);
    };
  }, [autoScroll, isStreaming, scrollElement]);

  // Reset auto-scroll when streaming starts (user submitted a new message)
  const prevIsStreaming = useRef(false);
  useEffect(() => {
    if (isStreaming && !prevIsStreaming.current) {
      shouldAutoScroll.current = true;
      setShowFollowLatest(false);
      if (scrollElement) {
        scrollElement.scrollTop = scrollElement.scrollHeight;
        lastScrollTopRef.current = scrollElement.scrollTop;
      }
    }
    prevIsStreaming.current = isStreaming;
  }, [isStreaming, scrollElement]);

  useEffect(() => {
    if (!isStreaming || !autoScroll) {
      setShowFollowLatest(false);
    }
  }, [autoScroll, isStreaming]);

  // Auto-scroll during streaming via interval
  useEffect(() => {
    if (!isStreaming || !shouldAutoScroll.current) return;

    const interval = setInterval(() => {
      if (!shouldAutoScroll.current || !scrollElement) return;
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }, 100);

    return () => clearInterval(interval);
  }, [isStreaming, scrollElement]);

  const handleFollowLatest = (): void => {
    shouldAutoScroll.current = autoScroll;
    setShowFollowLatest(false);
    if (!scrollElement) return;

    scrollElement.scrollTo({
      top: scrollElement.scrollHeight,
      behavior: 'smooth',
    });
    lastScrollTopRef.current = scrollElement.scrollTop;
  };

  // Increment batch counter when new groups appear (for staggered delay)
  useEffect(() => {
    mountBatchRef.current += 1;
  }, [messageGroups.length]);

  const clearSelectionAction = useCallback((): void => {
    setSelectionAction(null);
    setSelectionError(null);
    setIsSavingSelection(false);
  }, []);

  const updateSelectionAction = useCallback((): void => {
    if (!scrollElement || (!onAddSelectionToChat && !onAddSelectionToVault)) {
      clearSelectionAction();
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      clearSelectionAction();
      return;
    }

    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    if (
      !(anchor instanceof Node) ||
      !(focus instanceof Node) ||
      !scrollElement.contains(anchor) ||
      !scrollElement.contains(focus)
    ) {
      clearSelectionAction();
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      clearSelectionAction();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) {
      clearSelectionAction();
      return;
    }

    const maxX = Math.max(12, window.innerWidth - SELECTION_POPOVER_WIDTH_PX - 12);
    const x = Math.min(
      Math.max(12, rect.left + rect.width / 2 - SELECTION_POPOVER_WIDTH_PX / 2),
      maxX,
    );
    const y = Math.max(12, rect.top - 54);
    setSelectionAction({ text, x, y });
    setSelectionError(null);
  }, [clearSelectionAction, onAddSelectionToChat, onAddSelectionToVault, scrollElement]);

  useEffect(() => {
    if (!selectionAction) return;

    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (
        target instanceof Node &&
        selectionPopoverRef.current?.contains(target)
      ) {
        return;
      }
      clearSelectionAction();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        clearSelectionAction();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    scrollElement?.addEventListener('scroll', clearSelectionAction, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      scrollElement?.removeEventListener('scroll', clearSelectionAction);
    };
  }, [clearSelectionAction, scrollElement, selectionAction]);

  const handleAddSelectionToChat = useCallback((): void => {
    if (!selectionAction || !onAddSelectionToChat) return;
    onAddSelectionToChat(selectionAction.text);
    window.getSelection()?.removeAllRanges();
    clearSelectionAction();
  }, [clearSelectionAction, onAddSelectionToChat, selectionAction]);

  const handleAddSelectionToVault = useCallback(async (): Promise<void> => {
    if (!selectionAction || !onAddSelectionToVault || isSavingSelection) return;
    setIsSavingSelection(true);
    setSelectionError(null);
    try {
      await onAddSelectionToVault(selectionAction.text);
      window.getSelection()?.removeAllRanges();
      clearSelectionAction();
    } catch (error) {
      setSelectionError('Vault save failed');
      setIsSavingSelection(false);
      console.error('Failed to add chat selection to vault:', error);
    }
  }, [clearSelectionAction, isSavingSelection, onAddSelectionToVault, selectionAction]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={setScrollElement}
        onMouseUp={updateSelectionAction}
        onKeyUp={updateSelectionAction}
        className={`flex-1 overflow-y-auto overflow-x-hidden px-1 pb-2 pt-2 ${className}`}
        style={{ contain: 'layout style', scrollbarGutter: 'stable' }}
        data-virtualized-list="agent-message-feed"
        data-total-items={messageGroups.length}
        data-rendered-items={virtualizer.getVirtualItems().length}
      >
        <div
          style={{
            height: `${String(virtualizer.getTotalSize())}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const messageGroup = messageGroups[virtualItem.index];
            if (!messageGroup) return null;

            // Determine if this is a newly mounted group
            const isNew = !mountedGroupsRef.current.has(messageGroup.id);
            if (isNew) {
              mountedGroupsRef.current.add(messageGroup.id);
            }

            // Stagger delay: each new group in a batch gets 40ms more delay
            // Only apply to newly mounted groups
            const staggerIndex = isNew ? virtualItem.index : 0;

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                data-virtual-row
                ref={virtualizer.measureElement}
                className={isNew ? 'animate-in fade-in-0 slide-in-from-bottom-2 duration-200 fill-mode-backwards' : undefined}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${String(virtualItem.start)}px)`,
                  ...(isNew ? { animationDelay: `${staggerIndex * 40}ms` } : {}),
                }}
              >
                <MessageSection
                  sectionIndex={virtualItem.index}
                  messages={messageGroup.messages}
                  onToolApproval={onToolApproval}
                  onAnswerQuestion={onAnswerQuestion}
                />
              </div>
            );
          })}
        </div>
        {/* Spacer matching the sticky overlay height so the bottom of the
            virtualised list is never occluded by floating UI above the input. */}
        {bottomReservePx > 0 ? (
          <div aria-hidden="true" style={{ height: `${String(bottomReservePx)}px` }} />
        ) : null}
      </div>

      {selectionAction ? (
        <div
          ref={selectionPopoverRef}
          className="fixed z-50 w-[240px] rounded-[10px] border border-border/70 bg-popover/95 p-1.5 text-popover-foreground shadow-[0_18px_40px_-24px_rgba(0,0,0,0.65)] backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150"
          style={{ left: selectionAction.x, top: selectionAction.y }}
          role="toolbar"
          aria-label="Selected chat text actions"
        >
          <div className="flex items-center gap-1">
            {onAddSelectionToChat ? (
              <button
                type="button"
                onClick={handleAddSelectionToChat}
                className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] px-2.5 text-xs font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-accent-foreground active:scale-[0.97]"
              >
                <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">Add to chat</span>
              </button>
            ) : null}
            {onAddSelectionToVault ? (
              <button
                type="button"
                onClick={() => void handleAddSelectionToVault()}
                disabled={isSavingSelection}
                className="inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] px-2.5 text-xs font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-accent hover:text-accent-foreground active:scale-[0.97] disabled:cursor-default disabled:opacity-60"
              >
                <Archive className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{isSavingSelection ? 'Saving...' : 'Add to vault'}</span>
              </button>
            ) : null}
          </div>
          {selectionError ? (
            <div className="px-2 pb-1 pt-1.5 text-[11px] leading-tight text-destructive" role="status">
              {selectionError}
            </div>
          ) : null}
        </div>
      ) : null}

      {showFollowLatest ? (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex justify-center animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]"
          style={{ bottom: `${String(bottomReservePx + 12)}px` }}
        >
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  variant="muted"
                  size="lg"
                  label="Follow live chat"
                  title="Follow live chat"
                  onClick={handleFollowLatest}
                  className="pointer-events-auto size-10 rounded-full border border-border/50 bg-popover/90 text-foreground shadow-[0_10px_30px_-18px_rgba(0,0,0,0.65)] backdrop-blur-md transition-[background-color,color,border-color,box-shadow,transform] duration-150 hover:bg-card hover:text-primary active:scale-[0.96]"
                >
                  <ArrowDown aria-hidden="true" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent side="top">Follow live chat</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      ) : null}
    </div>
  );
};
