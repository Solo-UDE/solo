import { File, FilePlus, FileEdit, FileX } from 'lucide-react';

import type { FC } from 'react';

export interface FileEditInfo {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface FilesEditedListProps {
  files: FileEditInfo[];
  onFileClick?: (file: FileEditInfo) => void;
  className?: string;
}

export const FilesEditedList: FC<FilesEditedListProps> = ({
  files,
  onFileClick,
  className = '',
}) => {
  const getFileIcon = (status: FileEditInfo['status']): React.JSX.Element => {
    switch (status) {
      case 'added':
        return <FilePlus className="w-3 h-3" />;
      case 'modified':
        return <FileEdit className="w-3 h-3" />;
      case 'deleted':
        return <FileX className="w-3 h-3" />;
      default:
        return <File className="w-3 h-3" />;
    }
  };

  const getStatusColor = (status: FileEditInfo['status']): string => {
    switch (status) {
      case 'added':
        return 'text-success bg-success-muted';
      case 'modified':
        return 'text-info bg-info-muted';
      case 'deleted':
        return 'text-destructive bg-destructive/10';
      default:
        return 'text-muted-foreground bg-muted';
    }
  };

  const getFileName = (path: string): string => {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? path;
  };

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {files.map((file, index) => (
        <button
          key={`${file.path}-${String(index)}`}
          onClick={() => onFileClick?.(file)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${getStatusColor(
            file.status
          )} ${onFileClick ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
          title={file.path}
        >
          {getFileIcon(file.status)}
          <span className="truncate max-w-[200px]">{getFileName(file.path)}</span>
        </button>
      ))}
    </div>
  );
};
