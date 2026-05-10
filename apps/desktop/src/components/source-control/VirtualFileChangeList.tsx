import type { FC } from 'react';
import type { GitChangedFile } from '@/bindings/GitChangedFile';
import { VirtualList } from '@/components/ui/virtual-list';
import { FileChangeItem } from './FileChangeItem';

interface VirtualFileChangeListProps {
  readonly files: readonly GitChangedFile[];
  readonly className?: string;
  readonly testId: string;
  readonly onDiscard: (filePath: string) => void;
  readonly onViewDiff: (filePath: string) => void;
  readonly onStage?: (filePath: string) => void;
  readonly onUnstage?: (filePath: string) => void;
}

export const VirtualFileChangeList: FC<VirtualFileChangeListProps> = ({
  files,
  className,
  testId,
  onDiscard,
  onViewDiff,
  onStage,
  onUnstage,
}) => (
  <VirtualList
    items={files}
    estimateSize={() => 30}
    overscan={10}
    measureElement={false}
    className={className}
    getItemKey={(file) => file.path}
    testId={testId}
    renderItem={(file) => (
      <FileChangeItem
        file={file}
        onDiscard={onDiscard}
        onViewDiff={onViewDiff}
        onStage={onStage}
        onUnstage={onUnstage}
      />
    )}
  />
);
