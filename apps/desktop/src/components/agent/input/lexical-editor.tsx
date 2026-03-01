import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { $createParagraphNode, $getRoot, $nodesOfType } from 'lexical';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';

import { ClipboardImagePlugin } from './lexical/ClipboardImagePlugin';
import { MentionNode } from './lexical/MentionNode';
import { MentionPlugin } from './lexical/MentionPlugin';
import { SlashCommandPlugin } from './lexical/SlashCommandPlugin';

import type { EditorState, LexicalEditor as LexicalEditorType } from 'lexical';
import type { FileMention } from '../../../stores/agentStore';

export interface LexicalEditorHandle {
  clear: () => void;
  focus: () => void;
  insertText: (text: string) => void;
}

export interface LexicalEditorProps {
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  onMentionsChange?: (mentions: FileMention[]) => void;
  onLocalCommand?: (commandId: string) => void;
  onAgentCommand?: (commandText: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  mode?: 'planning' | 'fast';
}

function OnChangePluginWrapper({
  onChange,
  onMentionsChange,
}: {
  onChange: (value: string) => void;
  onMentionsChange?: (mentions: FileMention[]) => void;
}): React.JSX.Element {
  const handleChange = (editorState: EditorState): void => {
    editorState.read(() => {
      const root = $getRoot();
      const text = root.getTextContent();
      onChange(text);

      // Extract mentions from editor state
      if (onMentionsChange) {
        const mentionNodes = $nodesOfType(MentionNode);
        const mentions: FileMention[] = mentionNodes.map((node) => ({
          path: node.getFilePath(),
          name: node.getFileName(),
          relativePath: node.getRelativePath(),
        }));
        onMentionsChange(mentions);
      }
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

function EditorRefPlugin({ editorRef }: { editorRef: React.MutableRefObject<LexicalEditorType | null> }): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);

  return null;
}

/** Syncs the editor's editable state with the disabled prop */
function EditorDisabledPlugin({ disabled }: { disabled: boolean }): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  return null;
}

export const LexicalEditor = forwardRef<LexicalEditorHandle, LexicalEditorProps>(({
  onChange,
  onKeyDown,
  onMentionsChange,
  onLocalCommand,
  onAgentCommand,
  placeholder = 'Type something...',
  disabled = false,
  className = '',
  mode: _mode,
}, ref) => {
  const editorRef = useRef<LexicalEditorType | null>(null);

  useImperativeHandle(ref, () => ({
    clear: () => {
      const editor = editorRef.current;
      if (editor) {
        editor.update(() => {
          const root = $getRoot();
          root.clear();
          root.append($createParagraphNode());
        });
      }
    },
    focus: () => {
      editorRef.current?.focus();
    },
    insertText: (text: string) => {
      const editor = editorRef.current;
      if (editor) {
        // Focus the editor first — Lexical requires focus for selection to work
        editor.focus();
        editor.update(() => {
          const root = $getRoot();
          // Move cursor to end of last paragraph, then insert
          const lastChild = root.getLastChild();
          if (lastChild) {
            const selection = lastChild.selectEnd();
            selection.insertText(text);
          }
        });
      }
    },
  }));

  const initialConfig = useMemo(() => ({
    namespace: 'ChatInput',
    theme: {
      paragraph: 'mb-1',
      text: {
        bold: 'font-bold',
        italic: 'italic',
        underline: 'underline',
      },
    },
    nodes: [MentionNode],
    onError: (error: Error) => {
      console.error('Lexical error:', error);
    },
    editable: !disabled,
  }), [disabled]);

  return (
    <div className={`relative ${className}`}>
      <LexicalComposer initialConfig={initialConfig}>
        <div className="relative">
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                className={`
                  min-h-[80px] max-h-[200px] overflow-y-auto
                  px-4 py-3 bg-transparent
                  focus:outline-none
                  ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                `}
              />
            }
            placeholder={
              <div className="absolute top-3 left-4 text-muted-foreground/50 pointer-events-none">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <OnChangePluginWrapper onChange={onChange} onMentionsChange={onMentionsChange} />
          <EditorRefPlugin editorRef={editorRef} />
          <EditorDisabledPlugin disabled={disabled} />
          {onKeyDown ? <KeyDownPlugin onKeyDown={onKeyDown} /> : null}
          <ClipboardImagePlugin />
          <MentionPlugin />
          <SlashCommandPlugin
            onLocalCommand={onLocalCommand}
            onAgentCommand={onAgentCommand}
          />
        </div>
      </LexicalComposer>
    </div>
  );
});

LexicalEditor.displayName = 'LexicalEditor';
