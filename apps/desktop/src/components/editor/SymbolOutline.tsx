/**
 * SymbolOutline - Displays file structure as a tree of symbols
 * Click to navigate to symbol location
 */

import { useCallback, useMemo, useState } from 'react';
import { ChevronRightIcon, ChevronDownIcon } from '@radix-ui/react-icons';
import { Network } from 'lucide-react';
import { motion } from 'motion/react';
import { ListSkeleton } from '@/components/ui/skeletons';
import { VirtualList } from '@/components/ui/virtual-list';
import type { Symbol, SymbolKind } from '../../lib/tauri/parse';
import { getSymbolIcon, getSymbolKindName } from '../../lib/tauri/parse';

interface SymbolOutlineProps {
  symbols: Symbol[];
  isLoading?: boolean;
  error?: string | null;
  onSymbolClick?: (symbol: Symbol) => void;
  className?: string;
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

interface FlattenedSymbol {
  readonly key: string;
  readonly symbol: Symbol;
  readonly depth: number;
}

function flattenSymbols(
  symbols: readonly Symbol[],
  collapsed: ReadonlySet<string>,
  depth = 0,
  prefix = '',
): FlattenedSymbol[] {
  const rows: FlattenedSymbol[] = [];
  symbols.forEach((symbol, index) => {
    const key = `${prefix}/${symbol.name}:${symbol.kind}:${index}`;
    rows.push({ key, symbol, depth });
    if (symbol.children.length > 0 && !collapsed.has(key)) {
      rows.push(...flattenSymbols(symbol.children, collapsed, depth + 1, key));
    }
  });
  return rows;
}

export function SymbolOutline({
  symbols,
  isLoading,
  error,
  onSymbolClick,
  className = '',
}: SymbolOutlineProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const rows = useMemo(
    () => flattenSymbols(symbols, collapsed),
    [symbols, collapsed],
  );

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

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
    <VirtualList
      items={rows}
      estimateSize={() => 28}
      overscan={12}
      measureElement={false}
      className={`bg-background ${className}`}
      contentClassName="py-1"
      getItemKey={(row) => row.key}
      testId="symbol-outline"
      renderItem={(row) => {
        const { symbol, depth } = row;
        const hasChildren = symbol.children.length > 0;
        const isCollapsed = collapsed.has(row.key);
        return (
          <div
            className="
              flex items-center gap-1 py-0.5 px-2 cursor-pointer
              hover:bg-muted/60 rounded-md
              text-[13px] transition-colors duration-150
            "
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            onClick={() => onSymbolClick?.(symbol)}
            title={`${getSymbolKindName(symbol.kind)}: ${symbol.name}${symbol.detail ? ` ${symbol.detail}` : ''}`}
          >
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              {hasChildren ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(row.key);
                  }}
                  className="p-0.5 hover:bg-muted rounded-md transition-colors duration-150"
                >
                  {isCollapsed ? (
                    <ChevronRightIcon className="w-3 h-3 text-muted-foreground" />
                  ) : (
                    <ChevronDownIcon className="w-3 h-3 text-muted-foreground" />
                  )}
                </button>
              ) : null}
            </div>
            <span className={`shrink-0 font-mono text-xs ${getSymbolColor(symbol.kind)}`}>
              {getSymbolIcon(symbol.kind)}
            </span>
            <span className={`truncate ${getSymbolColor(symbol.kind)}`}>
              {symbol.name}
            </span>
            {symbol.detail && (
              <span className="text-muted-foreground truncate text-xs">{symbol.detail}</span>
            )}
          </div>
        );
      }}
    />
  );
}
