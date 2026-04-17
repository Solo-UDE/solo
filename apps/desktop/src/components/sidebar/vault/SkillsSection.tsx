/**
 * SkillsSection — Vault sub-tab for managing agent skills.
 *
 * Sessions already read skills via the skills store + the agent-bridge's
 * per-message content blocks (Option D UX). This Vault surface will
 * eventually let the user browse, install, and toggle skills at the
 * project level without opening a settings modal.
 */

import type { FC } from 'react';
import { Sparkles } from 'lucide-react';
import { VaultSectionShell } from './VaultSectionShell';

export const SkillsSection: FC = () => (
  <VaultSectionShell
    icon={Sparkles}
    title="Skills"
    description="Curate the agent capabilities available to this project. Skills ride along with messages as structured instructions for the model."
    previewItems={[
      { label: 'Browse installed skills', hint: 'See everything in .solo/skills/ and ~/.solo/skills/' },
      { label: 'Toggle per-project', hint: 'Override the global skill set for this repo only' },
      { label: 'Install from registry', hint: 'Pull vetted skills from community packs' },
    ]}
  />
);
