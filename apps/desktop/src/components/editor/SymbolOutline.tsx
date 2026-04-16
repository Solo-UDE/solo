/**
 * SymbolOutline - Displays file structure as a tree of symbols
 * Click to navigate to symbol location
 */

import { useState, useCallback } from 'react';
import { ChevronRightIcon, ChevronDownIcon } from '@radix-ui/react-icons';
import { Network } from 'lucide-react';
import { motion } from 'motion/react';
import { ListSkeleton } from '@/components/ui/skeletons';
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
 * Get color for symbol kind using design system syntax tokens
 */
function getSymbolColor(kind: SymbolKind): string {
  switch (kind) {
    case 'function':
    case 'method':
      return 'text-syntax-function';
    case 'class':
    case 'struct':
    case 'interface':
    case 'trait':
      return 'text-syntax-type';
    case 'enum':
    case 'enum_member':
      return 'text-syntax-number';
    case 'constant':
      return 'text-syntax-keyword';
    case 'variable':
    case 'property':
      return 'text-syntax-variable';
    case 'module':
      return 'text-syntax-control';
    case 'type_alias':
      return 'text-syntax-type';
    case 'macro':
      return 'text-syntax-keyword';
    default:
      return 'text-foreground';
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
          hover:bg-muted/60 rounded-md
          text-[13px] transition-colors duration-150
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
              className="p-0.5 hover:bg-muted rounded-md transition-colors duration-150"
            >
              {expanded ? (
                <ChevronDownIcon className="w-3 h-3 text-muted-foreground" />
              ) : (
                <ChevronRightIcon className="w-3 h-3 text-muted-foreground" />
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
          <span className="text-muted-foreground truncate text-xs">{symbol.detail}</span>
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
      <div className={`h-full bg-background ${className}`}>
        <ListSkeleton rows={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-center justify-center h-full bg-background ${className}`}
      >
        <div className="text-center px-4">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  if (symbols.length === 0) {
    return (
      <motion.div
        className={`flex flex-col items-center justify-center h-full bg-background gap-1.5 ${className}`}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <Network className="w-5 h-5 text-muted-foreground/30 mb-0.5" size={20} />
        <p className="text-xs text-muted-foreground/60">No symbols found</p>
      </motion.div>
    );
  }

  return (
    <div className={`bg-background overflow-auto ${className}`}>
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
