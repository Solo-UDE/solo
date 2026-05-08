import type { PanelProps } from '@/lib/panels/types';
import { Sparkles } from 'lucide-react';
import { SkillsSection } from '@/components/sidebar/vault/SkillsSection';
import { VaultPanelShell } from './VaultPanelShell';

export function SkillsPanel(_props: PanelProps) {
  return (
    <VaultPanelShell
      icon={Sparkles}
      title="Skills"
      description="Curate agent capabilities available to this project. Install from the marketplace, tweak installed skills locally, or manage forks."
      wide
    >
      <SkillsSection />
    </VaultPanelShell>
  );
}
