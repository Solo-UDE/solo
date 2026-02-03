/**
 * Attachment Store
 * Transient Zustand store for compose-time attachments and mentions.
 * Cleared on message submit.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Attachment, FileMention } from './agentStore';

interface AttachmentState {
	attachments: Attachment[];
	mentions: FileMention[];
}

interface AttachmentActions {
	addAttachment: (attachment: Attachment) => void;
	removeAttachment: (id: string) => void;
	addMention: (mention: FileMention) => void;
	removeMention: (path: string) => void;
	clear: () => void;
}

type AttachmentStore = AttachmentState & AttachmentActions;

export const useAttachmentStore = create<AttachmentStore>()(
	immer((set) => ({
		attachments: [],
		mentions: [],

		addAttachment: (attachment: Attachment) => {
			set((state) => {
				// Avoid duplicates by path
				if (!state.attachments.some((a) => a.path === attachment.path)) {
					state.attachments.push(attachment);
				}
			});
		},

		removeAttachment: (id: string) => {
			set((state) => {
				state.attachments = state.attachments.filter((a) => a.id !== id);
			});
		},

		addMention: (mention: FileMention) => {
			set((state) => {
				if (!state.mentions.some((m) => m.path === mention.path)) {
					state.mentions.push(mention);
				}
			});
		},

		removeMention: (path: string) => {
			set((state) => {
				state.mentions = state.mentions.filter((m) => m.path !== path);
			});
		},

		clear: () => {
			set((state) => {
				state.attachments = [];
				state.mentions = [];
			});
		},
	}))
);
