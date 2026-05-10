/**
 * PanelWrapper - Renders the content of a panel from the registry
 * Provides callbacks for panels to update their state
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { panelRegistry } from '@/lib/panels/registry';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import type { PanelInstance, PanelProps } from '@/lib/panels/types';
import { cn } from '@/lib/utils';

interface PanelWrapperProps {
  instance: PanelInstance;
  isActive: boolean;
  className?: string;
}

export function PanelWrapper({ instance, isActive, className }: PanelWrapperProps) {
  const wasActive = useRef(isActive);
  const [isSettling, setIsSettling] = useState(false);

  useEffect(() => {
    if (isActive && !wasActive.current) {
      setIsSettling(true);
      const timer = window.setTimeout(() => setIsSettling(false), 90);
      wasActive.current = isActive;
      return () => window.clearTimeout(timer);
    }
    wasActive.current = isActive;
  }, [isActive]);

  // Get actions directly from store to avoid selector subscription issues
  const actions = useMemo(() => {
    const state = usePanelTabsStore.getState();
    return {
      closePanel: state.closePanel,
      setDirty: state.setDirty,
      updateTitle: state.updateTitle,
      registerSaveCallback: state.registerSaveCallback,
    };
  }, []);

  const { closePanel, setDirty, updateTitle, registerSaveCallback } = actions;

  // Get the panel registration
  const registration = useMemo(
    () => panelRegistry.get(instance.panelType),
    [instance.panelType]
  );

  // Callbacks for the panel component
  const handleClose = useCallback(() => {
    closePanel(instance.id);
  }, [closePanel, instance.id]);

  const handleDirtyChange = useCallback(
    (isDirty: boolean) => {
      setDirty(instance.id, isDirty);
    },
    [setDirty, instance.id]
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      updateTitle(instance.id, title);
    },
    [updateTitle, instance.id]
  );

  const handleSaveCallbackChange = useCallback(
    (saveFn: (() => Promise<void>) | undefined) => {
      registerSaveCallback(instance.id, saveFn);
    },
    [registerSaveCallback, instance.id]
  );

  // If panel type not found, show error
  if (!registration) {
    return (
      <div
        className={cn(
          'h-full flex items-center justify-center text-destructive',
          className
        )}
      >
        <div className="text-center space-y-2">
          <p className="font-medium">Panel type not found</p>
          <p className="text-sm text-muted-foreground">
            "{instance.panelType}" is not registered
          </p>
        </div>
      </div>
    );
  }

  // Create the props for the panel component
  const panelProps: PanelProps = {
    instanceId: instance.id,
    data: instance.data,
    isActive,
    onClose: handleClose,
    onDirtyChange: handleDirtyChange,
    onTitleChange: handleTitleChange,
    onSaveCallbackChange: handleSaveCallbackChange,
  };

  const PanelComponent = registration.component;

  return (
    <div
      className={cn(
        'h-full w-full overflow-hidden',
        !isActive && 'hidden',
        isActive && isSettling && 'animate-in fade-in-0 zoom-in-[0.995] slide-in-from-bottom-[1px] duration-75',
        className
      )}
    >
      <PanelComponent {...panelProps} />
    </div>
  );
}
