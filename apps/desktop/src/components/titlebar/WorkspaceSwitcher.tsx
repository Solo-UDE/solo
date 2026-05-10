/**
 * WorkspaceSwitcher — title bar widget for switching workspaces
 * Shows "Solo" when no folder is open, or the directory name + dropdown when a folder is open.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDownIcon, PlusIcon, Cross2Icon } from '@radix-ui/react-icons';
import { FolderOpen, Folder, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useActiveRepo } from '@/stores/repoStore';
import { openFolderDialog } from '@/lib/tauri/fs';
import { cn } from '@/lib/utils';
import { VirtualList } from '@/components/ui/virtual-list';

/** Extract the last segment of a path */
const dirName = (p: string) => {
  const sep = p.includes('\\') ? '\\' : '/';
  return p.split(sep).pop() ?? p;
};

/** Truncate a path for display, keeping the last 2-3 segments */
const truncatePath = (p: string, maxLen = 45) => {
  if (p.length <= maxLen) return p;
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep);
  if (parts.length <= 3) return p;
  return `...${sep}${parts.slice(-3).join(sep)}`;
};

export function WorkspaceSwitcher() {
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const activeRepo = useActiveRepo();
  const recentDirectories = useWorkspaceStore((s) => s.recentDirectories);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);
  const removeRecent = useWorkspaceStore((s) => s.removeRecent);

  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const handleOpenFolder = useCallback(async () => {
    setOpen(false);
    const path = await openFolderDialog();
    if (path) {
      await switchWorkspace(path);
      toast.success(`Opened ${dirName(path)}`);
    }
  }, [switchWorkspace]);

  const handleSwitchTo = useCallback(async (path: string) => {
    setOpen(false);
    await switchWorkspace(path);
    toast.success(`Opened ${dirName(path)}`);
  }, [switchWorkspace]);

  const handleCloseFolder = useCallback(async () => {
    setOpen(false);
    await closeWorkspace();
    toast.success('Folder closed');
  }, [closeWorkspace]);

  const handleRemoveRecent = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    removeRecent(path);
  }, [removeRecent]);

  // Filter recents to exclude the currently open directory
  const filteredRecents = recentDirectories.filter((d) => d !== rootPath);

  // No folder open — just show "Solo"
  if (!rootPath) {
    return (
      <div className="flex items-center gap-1.5" data-tauri-drag-region={false}>
        <span className="text-xs font-medium text-muted-foreground/60">
          Solo
        </span>
        <button
          data-tauri-drag-region={false}
          onClick={handleOpenFolder}
          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-muted/60 hover:scale-105 active:scale-95 transition-[transform,background-color,color] duration-150"
          title="Open Folder"
        >
          <PlusIcon className="w-3 h-3 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-0.5" data-tauri-drag-region={false}>
      {/* Directory name + chevron trigger */}
      <button
        ref={triggerRef}
        data-tauri-drag-region={false}
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-1.5 px-2 h-[26px] rounded-lg transition-[transform,background-color,color] duration-150',
          'hover:bg-muted/60 active:scale-[0.97]',
          open && 'bg-muted/60',
        )}
        title={rootPath}
      >
        <FolderOpen className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-medium text-foreground/80 max-w-[180px] truncate">
          {dirName(rootPath)}
        </span>
        {activeRepo?.currentBranch && (
          <span className="text-[10px] text-muted-foreground/60 bg-muted/30 px-1.5 py-0.5 rounded-full truncate max-w-[80px]">
            {activeRepo.currentBranch}
          </span>
        )}
        <ChevronDownIcon
          className={cn(
            'w-2.5 h-2.5 text-muted-foreground/60 transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Plus button — open folder dialog */}
      <button
        data-tauri-drag-region={false}
        onClick={handleOpenFolder}
        className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-muted/60 hover:scale-105 active:scale-95 transition-[transform,background-color,color] duration-150"
        title="Open Folder"
      >
        <PlusIcon className="w-3 h-3 text-muted-foreground" />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={dropdownRef}
          className="absolute top-[calc(100%+6px)] left-1/2 -translate-x-1/2 min-w-[260px] max-w-[340px] bg-card/95 backdrop-blur-md rounded-[14px] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)] border border-border/30 overflow-hidden z-[100] animate-in fade-in slide-in-from-top-1 duration-150"
        >
          {/* Current directory */}
          <div className="px-3 py-2.5 border-b border-border/20">
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground truncate">
                  {dirName(rootPath)}
                </div>
                <div className="text-[10px] text-muted-foreground/60 truncate" title={rootPath}>
                  {truncatePath(rootPath)}
                </div>
              </div>
            </div>
          </div>

          {/* Open Folder action */}
          <div className="px-1.5 py-1.5 border-b border-border/20">
            <button
              onClick={handleOpenFolder}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs text-foreground/80 hover:bg-muted/60 transition-colors duration-150"
            >
              <Folder className="w-3.5 h-3.5 text-muted-foreground" />
              Open Folder...
            </button>
            <button
              onClick={handleCloseFolder}
              className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs text-foreground/80 hover:bg-muted/60 transition-colors duration-150"
            >
              <Cross2Icon className="w-3.5 h-3.5 text-muted-foreground" />
              Close Folder
            </button>
          </div>

          {/* Recent directories */}
          {filteredRecents.length > 0 && (
            <div className="px-1.5 py-1.5">
              <div className="flex items-center gap-1.5 px-2 py-1 mb-0.5">
                <Clock className="w-3 h-3 text-muted-foreground/50" />
                <span className="text-[10px] font-medium text-muted-foreground/50">Recent</span>
              </div>
              <VirtualList
                items={filteredRecents}
                estimateSize={() => 42}
                overscan={8}
                measureElement={false}
                className="max-h-[200px]"
                getItemKey={(path) => path}
                testId="workspace-switcher-recents"
                renderItem={(path) => (
                <button
                  onClick={() => handleSwitchTo(path)}
                  className="group w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs hover:bg-muted/60 transition-colors duration-150"
                >
                  <Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-foreground/80 truncate">{dirName(path)}</div>
                    <div className="text-[10px] text-muted-foreground/50 truncate" title={path}>
                      {truncatePath(path)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleRemoveRecent(e, path)}
                    className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-opacity duration-150"
                    title="Remove from recents"
                  >
                    <Cross2Icon className="w-3 h-3 text-muted-foreground" />
                  </button>
                </button>
                )}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
