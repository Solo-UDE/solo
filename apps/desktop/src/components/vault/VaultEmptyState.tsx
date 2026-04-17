/**
 * VaultEmptyState — shown under the drop zone when the vault is empty,
 * reinforcing the vault's purpose.
 */

import type { FC } from 'react';

export const VaultEmptyState: FC = () => (
  <div className="mt-5 px-1 flex flex-col gap-3 text-[11px] text-muted-foreground/80 leading-relaxed">
    <p className="font-medium text-foreground/80">What is the Vault?</p>
    <p>
      A durable memory for the agent. Drop anything you don't want to
      re-explain &mdash; schemas, specs, screenshots, runbooks &mdash; and
      the agent will retrieve it automatically when relevant.
    </p>
    <ul className="space-y-1 pl-3 list-disc marker:text-muted-foreground/40">
      <li>
        <span className="text-foreground/70">Project</span> memory stays inside
        one project.
      </li>
      <li>
        <span className="text-foreground/70">Global</span> memory is available
        everywhere.
      </li>
      <li>
        <span className="text-foreground/70">Pin</span> anything the agent must
        never forget.
      </li>
    </ul>
  </div>
);
