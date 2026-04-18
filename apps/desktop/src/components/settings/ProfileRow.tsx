import { Trash2 } from 'lucide-react';

import type { FC } from 'react';
import type { ProfileSummary } from '../../lib/backend';

export interface ProfileRowProps {
  profile: ProfileSummary;
  onSetActive: () => void;
  onRemove: () => void;
  disabled?: boolean;
}

/**
 * One profile row inside a ProviderCard. Radio indicates active profile;
 * email is the display label; trash button removes it.
 */
export const ProfileRow: FC<ProfileRowProps> = ({
  profile,
  onSetActive,
  onRemove,
  disabled,
}) => {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-none border transition-colors ${
        profile.isActive
          ? 'border-primary/40 bg-primary/5'
          : 'border-border hover:border-border/80'
      }`}
    >
      <button
        type="button"
        onClick={onSetActive}
        disabled={disabled || profile.isActive}
        aria-label={profile.isActive ? 'Active profile' : 'Set as active'}
        className={`w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
          profile.isActive
            ? 'border-primary bg-primary'
            : 'border-muted-foreground/40 hover:border-muted-foreground'
        }`}
      >
        {profile.isActive && <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate">
          {profile.email || profile.name}
        </div>
        {profile.isActive && (
          <div className="text-[10px] text-primary/80 uppercase tracking-wider">
            Active
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove account"
        className="p-1.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
