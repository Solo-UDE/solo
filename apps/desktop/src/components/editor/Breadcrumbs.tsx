/**
 * Breadcrumbs - Shows current scope path based on cursor position
 * Displays file path and symbol hierarchy
 */

import { useMemo, type ReactNode } from 'react';
import { ChevronRightIcon, FileTextIcon } from '@radix-ui/react-icons';
import type { Symbol } from '../../lib/tauri/parse';
import { getSymbolIcon } from '../../lib/tauri/parse';

interface BreadcrumbsProps {
  filePath: string | null;
  symbolPath: Symbol[];
  onSymbolClick?: (symbol: Symbol) => void;
  className?: string;
  rightContent?: ReactNode;
}

/**
 * Get file name from path
 */
function getFileName(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return lastSlash >= 0 ? path.substring(lastSlash + 1) : path;
}

/**
 * Get directory path from full path
 */
function getDirectoryPath(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return lastSlash >= 0 ? path.substring(0, lastSlash) : '';
}

export function Breadcrumbs({
  filePath,
  symbolPath,
  onSymbolClick,
  className = '',
  rightContent,
}: BreadcrumbsProps) {
  const fileName = useMemo(() => (filePath ? getFileName(filePath) : null), [filePath]);
  const dirPath = useMemo(() => (filePath ? getDirectoryPath(filePath) : null), [filePath]);

  if (!filePath) {
    return null;
  }

  return (
    <div
      className={`flex items-center justify-between h-7 px-3 bg-background/80 backdrop-blur-sm border-b border-border/20 ${className}`}
    >
      <div className="flex items-center gap-1 text-[11px] whitespace-nowrap overflow-x-auto">
        {/* Directory path */}
        {dirPath && (
          <>
            <span className="text-muted-foreground/70 truncate max-w-[200px]">{dirPath}</span>
            <ChevronRightIcon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          </>
        )}

        {/* File name */}
        <button
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors duration-150"
          title={filePath}
        >
          <FileTextIcon className="w-3 h-3" />
          <span>{fileName}</span>
        </button>

        {/* Symbol path */}
        {symbolPath.map((symbol, i) => (
          <div key={i} className="flex items-center gap-1">
            <ChevronRightIcon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
            <button
              onClick={() => onSymbolClick?.(symbol)}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors duration-150"
              title={`Go to ${symbol.name}`}
            >
              <span className="font-mono text-[10px]">{getSymbolIcon(symbol.kind)}</span>
              <span>{symbol.name}</span>
            </button>
          </div>
        ))}
      </div>

      {/* Right content slot */}
      {rightContent && <div className="flex items-center shrink-0 ml-2">{rightContent}</div>}
    </div>
  );
}
