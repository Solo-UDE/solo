import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { $createParagraphNode, $createTextNode, $getRoot, $isElementNode, $isTextNode, $nodesOfType, KEY_ARROW_UP_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';

import { ClipboardImagePlugin } from './lexical/ClipboardImagePlugin';
import { MentionNode } from './lexical/MentionNode';
import { MentionPlugin } from './lexical/MentionPlugin';
import { SkillChipNode, $createSkillChipNode } from './lexical/SkillChipNode';
import { SlashCommandPlugin } from './lexical/SlashCommandPlugin';

import type { EditorState, LexicalEditor as LexicalEditorType, LexicalNode } from 'lexical';
import type { FileMention, UserContentPart } from '../../../stores/agentStore';
import { $isSkillChipNode } from './lexical/SkillChipNode';

export interface LexicalEditorHandle {
  clear: () => void;
  focus: () => void;
  insertText: (text: string) => void;
  /** Replace the entire editor contents with plain text and place caret at the end. */
  setText: (text: string) => void;
  /** Insert a skill chip at the end of the current paragraph. */
  insertSkill: (skillName: string, description?: string) => void;
  /**
   * Walk the editor in document order and return an interleaved text/skill
   * sequence. Used at send-time so the rendered message bubble preserves the
   * exact order of chips relative to typed text.
   */
  getOrderedParts: () => UserContentPart[];
}

/** Depth-first walker that flattens the editor tree into ordered parts. */
function extractPartsFromEditor(editor: LexicalEditorType): UserContentPart[] {
  const parts: UserContentPart[] = [];

  const visit = (node: LexicalNode): void => {
    if ($isSkillChipNode(node)) {
      parts.push({ type: 'skill', name: node.getSkillName() });
      return;
    }
    if ($isTextNode(node)) {
      const text = node.getTextContent();
      if (text.length > 0) parts.push({ type: 'text', text });
      return;
    }
    if ($isElementNode(node)) {
      const children = node.getChildren();
      for (const child of children) visit(child);
    }
  };

  editor.getEditorState().read(() => {
    const root = $getRoot();
    const paragraphs = root.getChildren();
    paragraphs.forEach((p, i) => {
      // Separate paragraphs with newlines to preserve line breaks.
      if (i > 0) parts.push({ type: 'text', text: '\n' });
      visit(p);
    });
  });

  // Coalesce consecutive text parts to keep the output tidy.
  const merged: UserContentPart[] = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (p.type === 'text' && last && last.type === 'text') {
      last.text += p.text;
    } else {
      merged.push(p);
    }
  }
  return merged;
}

export interface LexicalEditorProps {
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  onMentionsChange?: (mentions: FileMention[]) => void;
  /** Fires with the list of skill names currently chipped into the editor. */
  onSkillsChange?: (skillNames: string[]) => void;
  onLocalCommand?: (commandId: string) => void;
  onAgentCommand?: (commandText: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  mode?: 'planning' | 'fast';
  /**
   * Fires when the user presses UP with an empty editor. Return `true` to signal
   * the caller consumed the event (UP will be swallowed); any falsy value lets
   * default caret-movement behavior run.
   */
  onEmptyUpArrow?: () => boolean;
}

function OnChangePluginWrapper({
  onChange,
  onMentionsChange,
  onSkillsChange,
}: {
  onChange: (value: string) => void;
  onMentionsChange?: (mentions: FileMention[]) => void;
  onSkillsChange?: (skillNames: string[]) => void;
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

      // Extract skill chips from editor state
      if (onSkillsChange) {
        const skillNodes = $nodesOfType(SkillChipNode);
        onSkillsChange(skillNodes.map((n) => n.getSkillName()));
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

/** Fires `onEmptyUpArrow` when the user presses UP while the editor is empty. */
function EmptyUpArrowPlugin({ onEmptyUpArrow }: { onEmptyUpArrow?: () => boolean }): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (!onEmptyUpArrow) return;
    return editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        let isEmpty = false;
        editor.getEditorState().read(() => {
          isEmpty = $getRoot().getTextContent().length === 0;
        });
        if (!isEmpty) return false;
        const consumed = onEmptyUpArrow();
        if (consumed) {
          event?.preventDefault?.();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, onEmptyUpArrow]);

  return null;
}

export const LexicalEditor = forwardRef<LexicalEditorHandle, LexicalEditorProps>(({
  onChange,
  onKeyDown,
  onMentionsChange,
  onSkillsChange,
  onLocalCommand,
  onAgentCommand,
  placeholder = 'Type something...',
  disabled = false,
  className = '',
  mode: _mode,
  onEmptyUpArrow,
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
    setText: (text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        if (text.length > 0) paragraph.append($createTextNode(text));
        root.append(paragraph);
        paragraph.selectEnd();
      });
    },
    insertSkill: (skillName: string, description?: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.update(() => {
        // De-dupe: if the same skill is already chipped, do nothing.
        const existing = $nodesOfType(SkillChipNode).find(
          (n) => n.getSkillName() === skillName,
        );
        if (existing) return;

        const root = $getRoot();
        const last = root.getLastChild();
        const target = last && $isElementNode(last) ? last : (() => {
          const p = $createParagraphNode();
          root.append(p);
          return p;
        })();
        const chip = $createSkillChipNode(skillName, description ?? '');
        // Insert chip followed by a space so the user can immediately keep typing.
        if (target.getChildrenSize() === 0) {
          target.append(chip, $createTextNode(' '));
        } else {
          target.append($createTextNode(' '), chip, $createTextNode(' '));
        }
        target.selectEnd();
      });
    },
    getOrderedParts: () => {
      const editor = editorRef.current;
      if (!editor) return [];
      return extractPartsFromEditor(editor);
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
    nodes: [MentionNode, SkillChipNode],
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
          <OnChangePluginWrapper
            onChange={onChange}
            onMentionsChange={onMentionsChange}
            onSkillsChange={onSkillsChange}
          />
          <EditorRefPlugin editorRef={editorRef} />
          <EditorDisabledPlugin disabled={disabled} />
          <EmptyUpArrowPlugin onEmptyUpArrow={onEmptyUpArrow} />
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
