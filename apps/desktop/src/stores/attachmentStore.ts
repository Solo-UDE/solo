/**
 * Attachment Store
 * Transient Zustand store for compose-time attachments.
 * Cleared on message submit.
 *
 * Note: Mentions are tracked via editor state (onMentionsChange) rather than
 * this store, to keep a single source of truth derived from the Lexical DOM.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Attachment } from './agentStore';

interface AttachmentState {
	attachments: Attachment[];
}

interface AttachmentActions {
	addAttachment: (attachment: Attachment) => void;
	removeAttachment: (id: string) => void;
	clear: () => void;
}

type AttachmentStore = AttachmentState & AttachmentActions;

export const useAttachmentStore = create<AttachmentStore>()(
	immer((set) => ({
		attachments: [],

		addAttachment: (attachment: Attachment) => {
			set((state) => {
				if (!state.attachments.some((a) => a.id === attachment.id)) {
					state.attachments.push(attachment);
				}
			});
		},

		removeAttachment: (id: string) => {
			set((state) => {
				state.attachments = state.attachments.filter((a) => a.id !== id);
			});
		},

		clear: () => {
			set((state) => {
				state.attachments = [];
			});
		},
	}))
);
