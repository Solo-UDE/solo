import { useRef, useCallback, useState } from 'react';
import { Cross2Icon, PaperPlaneIcon, EraserIcon } from '@radix-ui/react-icons';
import { SketchCanvas } from './SketchCanvas';
import { useAttachmentStore } from '../../../../stores/attachmentStore';
import type { SketchCanvasHandle } from './SketchCanvas';

interface SketchPopoverContentProps {
  onClose: () => void;
}

export function SketchPopoverContent({ onClose }: SketchPopoverContentProps) {
  const canvasRef = useRef<SketchCanvasHandle>(null);
  const addAttachment = useAttachmentStore((s) => s.addAttachment);
  const [isExporting, setIsExporting] = useState(false);

  const handleAttach = useCallback(async () => {
    if (!canvasRef.current || isExporting) return;
    setIsExporting(true);

    try {
      const result = await canvasRef.current.exportAsPng();
      if (!result) {
        setIsExporting(false);
        return;
      }

      addAttachment({
        id: `sketch-${Date.now()}`,
        type: 'image',
        path: '',
        name: `sketch-${Date.now()}.png`,
        mimeType: 'image/png',
        thumbnailUrl: result.dataUrl,
        base64Data: result.base64,
      });

      onClose();
    } finally {
      setIsExporting(false);
    }
  }, [addAttachment, onClose, isExporting]);

  const handleClear = useCallback(() => {
    canvasRef.current?.clear();
  }, []);

  return (
    <div className="flex flex-col w-[640px] h-[440px]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-sm font-medium text-foreground">Sketch</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          aria-label="Close sketch"
        >
          <Cross2Icon width={14} height={14} />
        </button>
      </div>

      {/* Canvas */}
      <SketchCanvas ref={canvasRef} className="flex-1 min-h-0" />

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border/50">
        <button
          type="button"
          onClick={handleClear}
          className="inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-[8px] text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <EraserIcon width={14} height={14} />
          Clear
        </button>
        <button
          type="button"
          onClick={handleAttach}
          disabled={isExporting}
          className="inline-flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] text-xs font-medium bg-foreground text-background hover:bg-foreground/90 active:scale-[0.97] transition-[transform,background-color] duration-200 disabled:opacity-50"
        >
          <PaperPlaneIcon width={14} height={14} />
          Attach to chat
        </button>
      </div>
    </div>
  );
}
