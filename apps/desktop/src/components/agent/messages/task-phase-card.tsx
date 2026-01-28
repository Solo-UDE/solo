import { FilesEditedList } from './files-edited-list';
import { ProgressUpdates } from './progress-updates';

import type { FC } from 'react';

export interface FileEdit {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface ProgressUpdate {
  step: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface TaskPhaseCardProps {
  title: string;
  summary: string;
  filesEdited?: FileEdit[];
  progressUpdates?: ProgressUpdate[];
  className?: string;
}

export const TaskPhaseCard: FC<TaskPhaseCardProps> = ({
  title,
  summary,
  filesEdited = [],
  progressUpdates = [],
  className = '',
}) => {
  return (
    <div
      className={`border border-border rounded-lg p-4 bg-card space-y-3 ${className}`}
    >
      {/* Title */}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {summary ? (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {summary}
          </p>
        ) : null}
      </div>

      {/* Files Edited Section */}
      {filesEdited.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Files Edited
          </h4>
          <FilesEditedList files={filesEdited} />
        </div>
      )}

      {/* Progress Updates Section */}
      {progressUpdates.length > 0 && (
        <div className="space-y-2">
          <ProgressUpdates updates={progressUpdates} />
        </div>
      )}
    </div>
  );
};
