/**
 * AutomationsPlaceholder - Placeholder for the Automations section in Studio mode.
 */

import type { FC } from 'react';
import { Zap } from 'lucide-react';

export const AutomationsPlaceholder: FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
    <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center">
      <Zap className="w-6 h-6 text-muted-foreground/40" />
    </div>
    <div>
      <p className="text-sm font-medium text-muted-foreground">Automations</p>
      <p className="text-xs text-muted-foreground/50 mt-1">
        Automate repetitive tasks and workflows with AI-powered pipelines.
      </p>
    </div>
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
      Coming Soon
    </span>
  </div>
);
