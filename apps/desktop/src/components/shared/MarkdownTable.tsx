/**
 * Shared markdown table component with scroll shadows, auto-compact mode,
 * and copy-as-TSV. Passed to Streamdown's `components` prop.
 */

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type FC,
  type ReactNode,
  type ComponentPropsWithoutRef,
} from 'react';
import { Copy, Check } from '@phosphor-icons/react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { cn } from '@/lib/utils';

import './markdown-table.css';

const COMPACT_THRESHOLD = 5;
const COPY_FEEDBACK_MS = 2000;

interface MarkdownTableProps {
  children: ReactNode;
}

/** Extract table cell text from the rendered DOM as TSV. */
function extractTSV(tableEl: HTMLTableElement): string {
  const rows = tableEl.querySelectorAll('tr');
  const lines: string[] = [];
  for (const row of rows) {
    const cells = row.querySelectorAll('th, td');
    const values: string[] = [];
    for (const cell of cells) {
      values.push((cell.textContent ?? '').replace(/\t/g, ' ').trim());
    }
    lines.push(values.join('\t'));
  }
  return lines.join('\n');
}

export const MarkdownTable: FC<MarkdownTableProps> = ({ children }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const [isCompact, setIsCompact] = useState(false);
  const [copied, setCopied] = useState(false);

  // Detect column count for compact mode
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const firstRow = table.querySelector('tr');
    if (!firstRow) return;
    const colCount = firstRow.querySelectorAll('th, td').length;
    setIsCompact(colCount > COMPACT_THRESHOLD);
  }, [children]);

  // Scroll shadow detection
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const wrapper = wrapperRef.current;
    if (!scrollEl || !wrapper) return;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = scrollEl;
      const hasOverflow = scrollWidth > clientWidth + 1;
      wrapper.classList.toggle('has-scroll-left', hasOverflow && scrollLeft > 1);
      wrapper.classList.toggle(
        'has-scroll-right',
        hasOverflow && scrollLeft < scrollWidth - clientWidth - 1,
      );
    };

    update();
    scrollEl.addEventListener('scroll', update, { passive: true });

    const observer = new ResizeObserver(update);
    observer.observe(scrollEl);

    return () => {
      scrollEl.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [children]);

  const handleCopy = useCallback(async () => {
    const table = tableRef.current;
    if (!table) return;
    try {
      const tsv = extractTSV(table);
      await writeText(tsv);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch (err) {
      console.error('Failed to copy table:', err);
    }
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={cn('md-table-wrapper', isCompact && 'md-table-compact')}
    >
      <div ref={scrollRef} className="md-table-scroll">
        <table ref={tableRef} className="md-table">
          {children}
        </table>
      </div>
      <button
        onClick={handleCopy}
        className={cn('md-table-copy', copied && 'copied')}
        title={copied ? 'Copied!' : 'Copy table as TSV'}
      >
        {copied ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
};

/**
 * Component overrides for Streamdown's `components` prop.
 * Spread into the components object: `{ ...markdownTableComponents, ... }`
 */
export const markdownTableComponents: Record<
  string,
  FC<ComponentPropsWithoutRef<'table'>>
> = {
  table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
};
