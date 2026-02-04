import { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import { Markdown } from '@tiptap/markdown';

import { MarkdownBubbleMenu } from './MarkdownBubbleMenu';
import './markdown-editor.css';
import './markdown-preview.css';

const DEBOUNCE_MS = 300;

interface MarkdownEditorProps {
  content: string;
  onContentChange: (md: string) => void;
}

export function MarkdownEditor({ content, onContentChange }: MarkdownEditorProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  const flush = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable code block from StarterKit — we use the default (plain) code block
        codeBlock: { HTMLAttributes: { class: '' } },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Image,
      TableKit.configure({ table: { resizable: false } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing...' }),
      Typography,
      Markdown,
    ],
    content,
    contentType: 'markdown',
    onUpdate: ({ editor: ed }) => {
      flush();
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const md = ed.getMarkdown();
        onContentChangeRef.current(md);
      }, DEBOUNCE_MS);
    },
  });

  // Flush pending writes on unmount so no edits are lost
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
        // Synchronously serialize and push to store
        if (editor && !editor.isDestroyed) {
          const md = editor.getMarkdown();
          onContentChangeRef.current(md);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="markdown-preview">
      <MarkdownBubbleMenu editor={editor} />
      <EditorContent editor={editor} className="markdown-body" />
    </div>
  );
}
