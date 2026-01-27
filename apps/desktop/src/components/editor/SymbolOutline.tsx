/**
 * SymbolOutline - Displays file structure as a tree of symbols
 * Click to navigate to symbol location
 */

import { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import type { Symbol, SymbolKind } from '../../lib/tauri/parse';
import { getSymbolIcon, getSymbolKindName } from '../../lib/tauri/parse';

interface SymbolOutlineProps {
  symbols: Symbol[];
  isLoading?: boolean;
  error?: string | null;
  onSymbolClick?: (symbol: Symbol) => void;
  className?: string;
}

interface SymbolNodeProps {
  symbol: Symbol;
  depth: number;
  onSymbolClick?: (symbol: Symbol) => void;
}

/**
 * Get color for symbol kind
 */
function getSymbolColor(kind: SymbolKind): string {
  switch (kind) {
    case 'function':
    case 'method':
      return 'text-[#dcdcaa]';
    case 'class':
    case 'struct':
    case 'interface':
    case 'trait':
      return 'text-[#4ec9b0]';
    case 'enum':
    case 'enum_member':
      return 'text-[#b5cea8]';
    case 'constant':
      return 'text-[#569cd6]';
    case 'variable':
    case 'property':
      return 'text-[#9cdcfe]';
    case 'module':
      return 'text-[#c586c0]';
    case 'type_alias':
      return 'text-[#4ec9b0]';
    case 'macro':
      return 'text-[#569cd6]';
    default:
      return 'text-[#d4d4d4]';
  }
}

function SymbolNode({ symbol, depth, onSymbolClick }: SymbolNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = symbol.children.length > 0;

  const handleClick = useCallback(() => {
    onSymbolClick?.(symbol);
  }, [symbol, onSymbolClick]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded(!expanded);
    },
    [expanded]
  );

  return (
    <div>
      <div
        className={`
          flex items-center gap-1 py-0.5 px-2 cursor-pointer
          hover:bg-[#2a2a2a] rounded
          text-[13px]
        `}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        title={`${getSymbolKindName(symbol.kind)}: ${symbol.name}${symbol.detail ? ` ${symbol.detail}` : ''}`}
      >
        {/* Expand/collapse toggle */}
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {hasChildren ? (
            <button
              onClick={handleToggle}
              className="p-0.5 hover:bg-[#3c3c3c] rounded"
            >
              {expanded ? (
                <ChevronDown className="w-3 h-3 text-[#8b8b8b]" />
              ) : (
                <ChevronRight className="w-3 h-3 text-[#8b8b8b]" />
              )}
            </button>
          ) : null}
        </div>

        {/* Symbol icon */}
        <span className={`shrink-0 font-mono text-xs ${getSymbolColor(symbol.kind)}`}>
          {getSymbolIcon(symbol.kind)}
        </span>

        {/* Symbol name */}
        <span className={`truncate ${getSymbolColor(symbol.kind)}`}>
          {symbol.name}
        </span>

        {/* Detail (e.g., function parameters) */}
        {symbol.detail && (
          <span className="text-[#6e7681] truncate text-xs">{symbol.detail}</span>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {symbol.children.map((child, i) => (
            <SymbolNode
              key={`${child.name}-${i}`}
              symbol={child}
              depth={depth + 1}
              onSymbolClick={onSymbolClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SymbolOutline({
  symbols,
  isLoading,
  error,
  onSymbolClick,
  className = '',
}: SymbolOutlineProps) {
  if (isLoading) {
    return (
      <div
        className={`flex items-center justify-center h-full bg-[#1e1e1e] ${className}`}
      >
        <div className="text-center space-y-2">
          <Loader2 className="w-5 h-5 text-[#007acc] animate-spin mx-auto" />
          <p className="text-xs text-[#6e7681]">Parsing...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-center justify-center h-full bg-[#1e1e1e] ${className}`}
      >
        <div className="text-center px-4">
          <p className="text-xs text-[#f44747]">{error}</p>
        </div>
      </div>
    );
  }

  if (symbols.length === 0) {
    return (
      <div
        className={`flex items-center justify-center h-full bg-[#1e1e1e] ${className}`}
      >
        <p className="text-xs text-[#6e7681]">No symbols</p>
      </div>
    );
  }

  return (
    <div className={`bg-[#1e1e1e] overflow-auto ${className}`}>
      <div className="py-1">
        {symbols.map((symbol, i) => (
          <SymbolNode
            key={`${symbol.name}-${i}`}
            symbol={symbol}
            depth={0}
            onSymbolClick={onSymbolClick}
          />
        ))}
      </div>
    </div>
  );
}
