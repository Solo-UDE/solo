import { useCallback } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/react';
import {
  FontBoldIcon,
  FontItalicIcon,
  StrikethroughIcon,
  CodeIcon,
  Link2Icon,
} from '@radix-ui/react-icons';
import {
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
} from 'lucide-react';

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
        <FontBoldIcon width={iconSize} height={iconSize} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('italic') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <FontItalicIcon width={iconSize} height={iconSize} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('strike') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Strikethrough"
      >
        <StrikethroughIcon width={iconSize} height={iconSize} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('code') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleCode().run()}
        title="Inline Code"
      >
        <CodeIcon width={iconSize} height={iconSize} />
      </button>

      <div className="separator" />

      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('heading', { level: 1 }) ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        <Heading1 size={iconSize} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('heading', { level: 2 }) ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        <Heading2 size={iconSize} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('heading', { level: 3 }) ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        <Heading3 size={iconSize} />
      </button>
      <button
        type="button"
        className={`bubble-menu-btn ${!editor.isActive('heading') ? 'is-active' : ''}`}
        onClick={() => editor.chain().focus().setParagraph().run()}
        title="Paragraph"
      >
        <Pilcrow size={iconSize} />
      </button>

      <div className="separator" />

      <button
        type="button"
        className={`bubble-menu-btn ${editor.isActive('link') ? 'is-active' : ''}`}
        onClick={setLink}
        title="Link"
      >
        <Link2Icon width={iconSize} height={iconSize} />
      </button>
    </BubbleMenu>
  );
}
