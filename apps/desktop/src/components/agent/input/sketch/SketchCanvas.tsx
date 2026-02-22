import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useCallback,
} from 'react';
import { Tldraw } from 'tldraw';
import type { Editor } from 'tldraw';
import 'tldraw/tldraw.css';

export interface SketchCanvasHandle {
  /** Export visible shapes as PNG. Returns null if canvas is empty. */
  exportAsPng: () => Promise<{ base64: string; dataUrl: string } | null>;
  clear: () => void;
}

interface SketchCanvasProps {
  className?: string;
}

export const SketchCanvas = forwardRef<SketchCanvasHandle, SketchCanvasProps>(
  ({ className }, ref) => {
    const editorRef = useRef<Editor | null>(null);

    const handleMount = useCallback((editor: Editor) => {
      editorRef.current = editor;
    }, []);

    useImperativeHandle(ref, () => ({
      exportAsPng: async () => {
        const editor = editorRef.current;
        if (!editor) return null;

        const shapeIds = [...editor.getCurrentPageShapeIds()];
        if (shapeIds.length === 0) return null;

        const { blob } = await editor.toImage(shapeIds, {
          format: 'png',
          background: true,
          padding: 16,
        });

        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            // Strip the data:image/png;base64, prefix for raw base64
            const base64 = dataUrl.split(',')[1];
            resolve({ base64, dataUrl });
          };
          reader.readAsDataURL(blob);
        });
      },

      clear: () => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.selectAll().deleteShapes(editor.getSelectedShapeIds());
      },
    }));

    return (
      <div className={className} style={{ contain: 'content' }}>
        <Tldraw inferDarkMode onMount={handleMount} />
      </div>
    );
  },
);

SketchCanvas.displayName = 'SketchCanvas';
