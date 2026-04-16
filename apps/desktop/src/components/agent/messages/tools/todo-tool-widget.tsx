import { ListChecks, CircleNotch, Check, Circle } from '@phosphor-icons/react';

import type { FC } from 'react';

interface TodoItem {
  id?: string;
  content?: string;
  status?: string;
  [key: string]: unknown;
}

interface TodoToolWidgetProps {
  readonly todos?: unknown[] | undefined;
  readonly isRunning?: boolean;
}

const parseTodo = (item: unknown): TodoItem => {
  if (typeof item === 'object' && item !== null) return item as TodoItem;
  if (typeof item === 'string') return { content: item };
  return { content: String(item) };
};

export const TodoToolWidget: FC<TodoToolWidgetProps> = ({
  todos,
  isRunning = false,
}) => {
  const items = todos?.map(parseTodo) ?? [];

  return (
    <div className="my-2 tool-widget-frame">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted">
        <ListChecks className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium text-foreground">
          {isRunning ? 'Updating Tasks...' : 'Tasks'}
        </span>
        {isRunning ? <CircleNotch className="h-3 w-3 animate-spin text-muted-foreground ml-auto" /> : null}
      </div>

      {items.length > 0 ? (
        <div className="p-2 space-y-1">
          {items.map((item, i) => {
            const isDone = item.status === 'completed' || item.status === 'done';
            return (
              <div key={item.id ?? `todo-${String(i)}`} className="flex items-start gap-2 px-2 py-1">
                {isDone ? (
                  <Check className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" weight="bold" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                )}
                <span className={`text-xs ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {item.content ?? JSON.stringify(item)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
