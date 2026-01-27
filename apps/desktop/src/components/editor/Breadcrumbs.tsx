/**
 * Breadcrumbs - Shows current scope path based on cursor position
 * Displays file path and symbol hierarchy
 */

import { useMemo } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import type { Symbol } from '../../lib/tauri/parse';
import { getSymbolIcon } from '../../lib/tauri/parse';

interface BreadcrumbsProps {
  filePath: string | null;
  symbolPath: Symbol[];
  onSymbolClick?: (symbol: Symbol) => void;
  className?: string;
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
}: BreadcrumbsProps) {
  const fileName = useMemo(() => (filePath ? getFileName(filePath) : null), [filePath]);
  const dirPath = useMemo(() => (filePath ? getDirectoryPath(filePath) : null), [filePath]);

  if (!filePath) {
    return null;
  }

  return (
    <div
      className={`flex items-center h-6 px-3 bg-[#1e1e1e] border-b border-[#2d2d2d] overflow-x-auto ${className}`}
    >
      <div className="flex items-center gap-1 text-[11px] whitespace-nowrap">
        {/* Directory path */}
        {dirPath && (
          <>
            <span className="text-[#6e7681] truncate max-w-[200px]">{dirPath}</span>
            <ChevronRight className="w-3 h-3 text-[#6e7681] shrink-0" />
          </>
        )}

        {/* File name */}
        <button
          className="flex items-center gap-1 text-[#8b8b8b] hover:text-white transition-colors"
          title={filePath}
        >
          <FileText className="w-3 h-3" />
          <span>{fileName}</span>
        </button>

        {/* Symbol path */}
        {symbolPath.map((symbol, i) => (
          <div key={i} className="flex items-center gap-1">
            <ChevronRight className="w-3 h-3 text-[#6e7681] shrink-0" />
            <button
              onClick={() => onSymbolClick?.(symbol)}
              className="flex items-center gap-1 text-[#8b8b8b] hover:text-white transition-colors"
              title={`Go to ${symbol.name}`}
            >
              <span className="font-mono text-[10px]">{getSymbolIcon(symbol.kind)}</span>
              <span>{symbol.name}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
