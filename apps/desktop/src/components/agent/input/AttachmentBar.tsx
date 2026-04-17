/**
 * AttachmentBar - Displays image thumbnails and file chips below the editor.
 * Shown during message composition, cleared on submit.
 */

import { Cross2Icon } from '@radix-ui/react-icons';
import { Paperclip } from 'lucide-react';
import { useAttachmentStore } from '../../../stores/attachmentStore';
import { AnimatedList } from '@/components/ui/animated-list';

import type { FC } from 'react';

export const AttachmentBar: FC = () => {
	const attachments = useAttachmentStore((s) => s.attachments);
	const removeAttachment = useAttachmentStore((s) => s.removeAttachment);

	if (attachments.length === 0) return null;

	const images = attachments.filter((a) => a.type === 'image');
	const files = attachments.filter((a) => a.type === 'file');

	return (
		<div className="px-1 py-2 space-y-2">
			{/* Image thumbnails */}
			{images.length > 0 && (
				<AnimatedList className="flex gap-2 flex-wrap" stagger={0.03} slideY={4}>
					{images.map((img) => (
						<div
							key={img.id}
							className="relative group w-16 h-16 rounded-md overflow-hidden border border-border bg-muted"
						>
							<img
								src={img.thumbnailUrl}
								alt={img.name}
								className="w-full h-full object-cover"
							/>
							<button
								onClick={() => removeAttachment(img.id)}
								className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 bg-black/60 rounded-full p-0.5 transition-opacity"
								type="button"
							>
								<Cross2Icon width={12} height={12} className="text-white" />
							</button>
							<div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
								<span className="text-[10px] text-white truncate block">
									{img.name}
								</span>
							</div>
						</div>
					))}
				</AnimatedList>
			)}

			{/* File chips */}
			{files.length > 0 && (
				<AnimatedList className="flex gap-1.5 flex-wrap" stagger={0.025} slideY={4}>
					{files.map((file) => (
						<div
							key={file.id}
							className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted border border-border text-xs"
						>
							<Paperclip className="w-3 h-3 text-muted-foreground shrink-0" />
							<span className="truncate max-w-[140px] text-foreground">
								{file.name}
							</span>
							<button
								onClick={() => removeAttachment(file.id)}
								className="hover:bg-muted-foreground/20 rounded-full p-0.5 transition-colors"
								type="button"
							>
								<Cross2Icon width={12} height={12} className="text-muted-foreground" />
							</button>
						</div>
					))}
				</AnimatedList>
			)}
		</div>
	);
};
