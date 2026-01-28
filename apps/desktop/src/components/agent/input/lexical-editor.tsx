import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { $getRoot } from 'lexical';
import { useEffect } from 'react';

import type { EditorState } from 'lexical';

export interface LexicalEditorProps {
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

function OnChangePluginWrapper({ onChange }: { onChange: (value: string) => void }): React.JSX.Element {
  const handleChange = (editorState: EditorState): void => {
    editorState.read(() => {
      const root = $getRoot();
      const text = root.getTextContent();
      onChange(text);
    });
  };

  return <OnChangePlugin onChange={handleChange} />;
}

function KeyDownPlugin({ onKeyDown }: { onKeyDown?: (event: React.KeyboardEvent) => void }): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onKeyDown) return;

    return editor.registerRootListener((rootElement, prevRootElement) => {
      const handler = onKeyDown as unknown as (this: HTMLElement, ev: KeyboardEvent) => void;
      if (prevRootElement !== null) {
        prevRootElement.removeEventListener('keydown', handler);
      }
      if (rootElement !== null) {
        rootElement.addEventListener('keydown', handler);
      }
    });
  }, [editor, onKeyDown]);

  return null;
}

export const LexicalEditor: React.FC<LexicalEditorProps> = ({
  onChange,
  onKeyDown,
  placeholder = 'Type something...',
  disabled = false,
  className = '',
}) => {
  const initialConfig = {
    namespace: 'ChatInput',
    theme: {
      paragraph: 'mb-1',
      text: {
        bold: 'font-bold',
        italic: 'italic',
        underline: 'underline',
      },
    },
    onError: (error: Error) => {
      console.error('Lexical error:', error);
    },
    editable: !disabled,
  };

  return (
    <div className={`relative ${className}`}>
      <LexicalComposer initialConfig={initialConfig}>
        <div className="relative">
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className={`
                  min-h-[80px] max-h-[200px] overflow-y-auto
                  px-4 py-3 rounded-lg border border-border
                  focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent
                  ${disabled ? 'bg-muted cursor-not-allowed' : 'bg-background'}
                `}
              />
            }
            placeholder={
              <div className="absolute top-3 left-4 text-muted-foreground pointer-events-none">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <OnChangePluginWrapper onChange={onChange} />
          {onKeyDown ? <KeyDownPlugin onKeyDown={onKeyDown} /> : null}
        </div>
      </LexicalComposer>
    </div>
  );
};
