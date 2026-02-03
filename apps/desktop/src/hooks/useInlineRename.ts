import { useState, useRef, useEffect, useCallback } from 'react';
import type { RefObject } from 'react';

interface UseInlineRenameReturn {
  renamingId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  startRename: (id: string, currentValue: string) => void;
  commitRename: () => void;
  cancelRename: () => void;
  getInputProps: () => {
    ref: RefObject<HTMLInputElement | null>;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
    onBlur: () => void;
    onClick: (e: React.MouseEvent) => void;
  };
}

/**
 * Shared hook for inline rename across tabs and list items.
 * Manages rename state, auto-focus/select, and keyboard/blur commit/cancel.
 */
export function useInlineRename(
  onCommit: (id: string, value: string) => void,
): UseInlineRenameReturn {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const startRename = useCallback((id: string, currentValue: string) => {
    setRenamingId(id);
    setRenameValue(currentValue);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId) {
      const trimmed = renameValue.trim();
      if (trimmed) onCommit(renamingId, trimmed);
      setRenamingId(null);
      setRenameValue('');
    }
  }, [renamingId, renameValue, onCommit]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  // Auto-focus and select-all when entering rename mode
  useEffect(() => {
    if (renamingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingId]);

  const getInputProps = useCallback(
    () => ({
      ref: inputRef,
      value: renameValue,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRenameValue(e.target.value),
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitRename();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelRename();
        }
      },
      onBlur: commitRename,
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    }),
    [renameValue, commitRename, cancelRename],
  );

  return {
    renamingId,
    renameValue,
    setRenameValue,
    inputRef,
    startRename,
    commitRename,
    cancelRename,
    getInputProps,
  };
}
