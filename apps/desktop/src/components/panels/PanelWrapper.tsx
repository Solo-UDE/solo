/**
 * PanelWrapper - Renders the content of a panel from the registry
 * Provides callbacks for panels to update their state
 */

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
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
  // Track when panel becomes active to trigger fade-in
  const wasActive = useRef(isActive);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    if (isActive && !wasActive.current) {
      setShouldAnimate(true);
      const timer = setTimeout(() => setShouldAnimate(false), 150);
      return () => clearTimeout(timer);
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
    };
  }, []);

  const { closePanel, setDirty, updateTitle } = actions;

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
  };

  const PanelComponent = registration.component;

  return (
    <div
      className={cn(
        'h-full w-full overflow-hidden',
        !isActive && 'hidden',
        isActive && shouldAnimate && 'animate-in fade-in-0 duration-150',
        className
      )}
    >
      <PanelComponent {...panelProps} />
    </div>
  );
}
