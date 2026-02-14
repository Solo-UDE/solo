import { create } from 'zustand';

export interface DragPayload {
	path: string;
	name: string;
	isDir: boolean;
}

interface DragState {
	/** The file tree item currently being dragged, or null */
	payload: DragPayload | null;
	/** Whether the drag has passed the movement threshold */
	active: boolean;
	startDrag: (payload: DragPayload) => void;
	activateDrag: () => void;
	endDrag: () => void;
}

export const useDragStore = create<DragState>()((set) => ({
	payload: null,
	active: false,
	startDrag: (payload) => set({ payload, active: false }),
	activateDrag: () => set({ active: true }),
	endDrag: () => set({ payload: null, active: false }),
}));
