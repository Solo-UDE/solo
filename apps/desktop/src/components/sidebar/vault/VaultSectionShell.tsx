/**
 * VaultSectionShell — richer replacement for the generic VaultPlaceholder.
 *
 * Each Vault section describes *what will live there* rather than just
 * showing a "Coming soon" pill. That gives the user a preview of the
 * feature's scope (what kinds of entries appear, what actions are planned)
 * without requiring the feature to ship first. When a section's real
 * implementation lands, the section component swaps this shell for its
 * production body; this shell stays around for whichever sections are still
 * in flight.
 */

import type { FC, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';

export interface PreviewItem {
  readonly label: string;
  readonly hint?: string;
}

export interface VaultSectionShellProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  /** 0–4 bullet-style rows previewing what the section will contain. */
  readonly previewItems?: readonly PreviewItem[];
  /** Optional status label — "Coming soon", "Beta", etc. */
  readonly status?: string;
  /** Slot for a single call-to-action button when the section supports one. */
  readonly action?: ReactNode;
}

export const VaultSectionShell: FC<VaultSectionShellProps> = ({
  icon: Icon,
  title,
  description,
  previewItems,
  status = 'Coming soon',
  action,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.18 }}
    className="flex h-full flex-col gap-4 px-4 py-5"
  >
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border border-border/70 bg-background/65">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {status ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-primary/80">
              {status}
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>

    {previewItems && previewItems.length > 0 ? (
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">
          What will live here
        </p>
        <ul className="flex flex-col gap-1.5">
          {previewItems.map((item) => (
            <li
              key={item.label}
              className="flex items-start gap-2 rounded-[8px] border border-border/50 bg-background/35 px-3 py-2"
            >
              <span
                className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/45"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-foreground">
                  {item.label}
                </p>
                {item.hint ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {item.hint}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    ) : null}

    {action ? <div className="mt-auto">{action}</div> : null}
  </motion.div>
);
