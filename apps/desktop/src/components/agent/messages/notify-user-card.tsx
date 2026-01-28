import { Info, AlertTriangle, XCircle, CheckCircle } from 'lucide-react';

import type { FC } from 'react';

export interface NotificationAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'primary' | 'destructive';
}

export interface NotifyUserCardProps {
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
  actions?: NotificationAction[];
  className?: string;
}

export const NotifyUserCard: FC<NotifyUserCardProps> = ({
  type,
  message,
  actions = [],
  className = '',
}) => {
  const getIcon = (): React.JSX.Element => {
    switch (type) {
      case 'success':
        return <CheckCircle className="w-4 h-4" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4" />;
      case 'error':
        return <XCircle className="w-4 h-4" />;
      case 'info':
      default:
        return <Info className="w-4 h-4" />;
    }
  };

  const getStyles = (): { container: string; icon: string; text: string } => {
    switch (type) {
      case 'success':
        return {
          container: 'bg-success-muted border-success/30',
          icon: 'text-success',
          text: 'text-success-foreground',
        };
      case 'warning':
        return {
          container: 'bg-warning-muted border-warning/30',
          icon: 'text-warning',
          text: 'text-warning-foreground',
        };
      case 'error':
        return {
          container: 'bg-destructive/10 border-destructive/30',
          icon: 'text-destructive',
          text: 'text-foreground',
        };
      case 'info':
      default:
        return {
          container: 'bg-info-muted border-info/30',
          icon: 'text-info',
          text: 'text-info-foreground',
        };
    }
  };

  const getButtonStyles = (variant: NotificationAction['variant'] = 'default'): string => {
    switch (variant) {
      case 'primary':
        return 'bg-primary text-primary-foreground hover:bg-primary/90';
      case 'destructive':
        return 'bg-destructive text-destructive-foreground hover:bg-destructive/90';
      case 'default':
      default:
        return 'bg-background text-foreground hover:bg-accent';
    }
  };

  const styles = getStyles();

  return (
    <div
      className={`border rounded-lg p-4 ${styles.container} ${className}`}
    >
      <div className="flex gap-3">
        {/* Icon */}
        <div className={`flex-shrink-0 ${styles.icon}`}>
          {getIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Message */}
          <p className={`text-sm leading-relaxed ${styles.text}`}>
            {message}
          </p>

          {/* Actions */}
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.map((action, index) => (
                <button
                  key={index}
                  onClick={action.onClick}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${getButtonStyles(
                    action.variant
                  )}`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
