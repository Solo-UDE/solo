import { useCallback } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/react';
import {
  TextB,
  TextItalic,
  TextStrikethrough,
  Code,
  TextHOne,
  TextHTwo,
  TextHThree,
  Paragraph,
  Link as LinkIcon,
} from '@phosphor-icons/react';

interface MarkdownBubbleMenuProps {
  editor: Editor;
}

export function MarkdownBubbleMenu({ editor }: MarkdownBubbleMenuProps) {
  const setLink = useCallback(() => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL', prev ?? 'https://');
    if (url === null) return; // cancelled
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const iconSize = 16;
  const iconWeight = 'bold' as const;

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top', offset: 8 }}
      className="markdown-bubble-menu"
    >
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('bold') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <TextB size={iconSize} weight={iconWeight} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <TextItalic size={iconSize} weight={iconWeight} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <TextStrikethrough size={iconSize} weight={iconWeight} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('code') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline Code"
      >
        <Code size={iconSize} weight={iconWeight} />
      </button>

      <div className="separator" />

      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        <TextHOne size={iconSize} weight={iconWeight} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        <TextHTwo size={iconSize} weight={iconWeight} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        <TextHThree size={iconSize} weight={iconWeight} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${!editor.isActive('heading') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().setParagraph().run()}
        title="Paragraph"
      >
        <Paragraph size={iconSize} weight={iconWeight} />
      </button>

      <div className="separator" />

      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('link') ? 'is-active' : ''}`}
        onClick={setLink}
        title="Link"
      >
        <LinkIcon size={iconSize} weight={iconWeight} />
      </button>
    </BubbleMenu>
  );
}
