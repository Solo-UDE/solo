/**
 * Breadcrumbs - Shows current scope path based on cursor position
 * Displays file path and symbol hierarchy with clickable segments
 */

import { useMemo, type ReactNode } from 'react';
import { ChevronRight, FileText, Folder } from 'lucide-react';
import type { Symbol } from '../../lib/tauri/parse';
import { getSymbolIcon } from '../../lib/tauri/parse';
import { cn } from '../../lib/utils';

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
 * Split path into segments
 */
function getPathSegments(path: string): string[] {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean);
}

/**
 * BreadcrumbItem - clickable segment with hover brightness lift
 */
function BreadcrumbItem({
  children,
  onClick,
  title,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  icon?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-1 py-0.5 rounded',
        'text-muted-foreground',
        'transition-all duration-150',
        'hover:text-foreground hover:brightness-110 hover:bg-bg-surface-2',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50'
      )}
      title={title}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

/**
 * Separator chevron
 */
function BreadcrumbSeparator() {
  return <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0 mx-0.5" />;
}

export function Breadcrumbs({
  filePath,
  symbolPath,
  onSymbolClick,
  className = '',
  rightContent,
}: BreadcrumbsProps) {
  const fileName = useMemo(() => (filePath ? getFileName(filePath) : null), [filePath]);
  const pathSegments = useMemo(
    () => (filePath ? getPathSegments(filePath).slice(0, -1) : []), // Exclude file name
    [filePath]
  );

  // Show last 2-3 directory segments for context
  const visibleSegments = useMemo(() => {
    if (pathSegments.length <= 3) return pathSegments;
    return ['...', ...pathSegments.slice(-2)];
  }, [pathSegments]);

  if (!filePath) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between h-7 px-2',
        'bg-bg-surface-1/50 backdrop-blur-sm border-b border-border-subtle',
        className
      )}
    >
      <div className="flex items-center text-[11px] whitespace-nowrap overflow-x-auto scrollbar-none">
        {/* Directory path segments */}
        {visibleSegments.map((segment, i) => (
          <div key={i} className="flex items-center">
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem
              icon={segment !== '...' ? <Folder className="w-3 h-3" /> : undefined}
              title={segment === '...' ? pathSegments.slice(0, -2).join('/') : segment}
            >
              {segment}
            </BreadcrumbItem>
          </div>
        ))}

        {/* Separator before file name */}
        {visibleSegments.length > 0 && <BreadcrumbSeparator />}

        {/* File name */}
        <BreadcrumbItem
          icon={<FileText className="w-3 h-3" />}
          title={filePath}
        >
          {fileName}
        </BreadcrumbItem>

        {/* Symbol path */}
        {symbolPath.map((symbol, i) => (
          <div key={i} className="flex items-center">
            <BreadcrumbSeparator />
            <BreadcrumbItem
              onClick={() => onSymbolClick?.(symbol)}
              title={`Go to ${symbol.name}`}
              icon={<span className="font-mono text-[10px]">{getSymbolIcon(symbol.kind)}</span>}
            >
              {symbol.name}
            </BreadcrumbItem>
          </div>
        ))}
      </div>

      {/* Right content slot */}
      {rightContent && <div className="flex items-center shrink-0 ml-2">{rightContent}</div>}
    </div>
  );
}
