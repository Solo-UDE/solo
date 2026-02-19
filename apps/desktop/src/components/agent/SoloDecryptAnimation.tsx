import { useEffect, useRef, useCallback, useState } from 'react';
import { Code, Lightning, GitBranch } from '@phosphor-icons/react';

import type { FC } from 'react';

// ─── Pixel font: 5×7 grids for S, O, L, O ─────────────────────────────────
// 1 = filled block, 0 = empty
const LETTER_S = [
	[0, 1, 1, 1, 0],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 0],
	[0, 1, 1, 1, 0],
	[0, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
	[0, 1, 1, 1, 0],
];

const LETTER_O = [
	[0, 1, 1, 1, 0],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
	[0, 1, 1, 1, 0],
];

const LETTER_L = [
	[1, 0, 0, 0, 0],
	[1, 0, 0, 0, 0],
	[1, 0, 0, 0, 0],
	[1, 0, 0, 0, 0],
	[1, 0, 0, 0, 0],
	[1, 0, 0, 0, 0],
	[1, 1, 1, 1, 1],
];

// Letters with column offsets (5 cols each + 2 col gap between letters)
const LETTERS: { grid: number[][]; colOffset: number }[] = [
	{ grid: LETTER_S, colOffset: 0 },   // S: cols 0-4
	{ grid: LETTER_O, colOffset: 7 },   // O: cols 7-11
	{ grid: LETTER_L, colOffset: 14 },  // L: cols 14-18
	{ grid: LETTER_O, colOffset: 21 },  // O: cols 21-25
];

// Block size and gap
const BLOCK_SIZE = 6;
const GAP = 2;
const CELL = BLOCK_SIZE + GAP; // 8px per cell
const GRID_COLS = 26;
const GRID_ROWS = 7;
const GRID_WIDTH = GRID_COLS * CELL - GAP;  // 206px
const GRID_HEIGHT = GRID_ROWS * CELL - GAP; // 54px

// Pre-compute all "on" block positions
interface BlockPosition {
	col: number;
	row: number;
	x: number; // target x in px
	y: number; // target y in px
	index: number; // reading-order index for stagger
}

const BLOCKS: BlockPosition[] = [];
let blockIndex = 0;
for (const { grid, colOffset } of LETTERS) {
	for (let row = 0; row < 7; row++) {
		for (let col = 0; col < 5; col++) {
			if (grid[row][col] === 1) {
				BLOCKS.push({
					col: colOffset + col,
					row,
					x: (colOffset + col) * CELL,
					y: row * CELL,
					index: blockIndex++,
				});
			}
		}
	}
}

const TOTAL_BLOCKS = BLOCKS.length; // 56

// Animation phase durations
const SCRAMBLE_DURATION = 1200;
const ASSEMBLE_DURATION = 800;
const HOLD_DURATION = 3000;
const SCATTER_DURATION = 600;

// Stagger delays
const SCRAMBLE_STAGGER = 20; // ms per block
const ASSEMBLE_STAGGER = 14; // ms per block

// ─── Reduced motion hook ────────────────────────────────────────────────────
const useReducedMotion = () => {
	const [reduced, setReduced] = useState(() => {
		if (typeof window === 'undefined') return false;
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	});

	useEffect(() => {
		const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
		const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	}, []);

	return reduced;
};

// ─── Random helpers ─────────────────────────────────────────────────────────
const randRange = (min: number, max: number) =>
	Math.random() * (max - min) + min;

// ─── Decrypt Animation Component ────────────────────────────────────────────
const SoloDecryptAnimation: FC = () => {
	const reducedMotion = useReducedMotion();
	const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
	const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

	const clearTimers = useCallback(() => {
		for (const t of timersRef.current) clearTimeout(t);
		timersRef.current = [];
	}, []);

	const scheduleTimer = useCallback((fn: () => void, delay: number) => {
		const t = setTimeout(fn, delay);
		timersRef.current.push(t);
		return t;
	}, []);

	// Apply styles directly to DOM refs — no React re-renders
	const applyScramble = useCallback(() => {
		const shuffled = [...Array(TOTAL_BLOCKS).keys()].sort(() => Math.random() - 0.5);

		for (let i = 0; i < TOTAL_BLOCKS; i++) {
			const blockIdx = shuffled[i];
			const el = blockRefs.current[blockIdx];
			if (!el) continue;

			const offsetX = randRange(-20, 20);
			const offsetY = randRange(-20, 20);
			const opacity = randRange(0.1, 0.5);
			const delay = i * SCRAMBLE_STAGGER;

			el.style.transition = 'none';
			el.style.transform = `translate(${BLOCKS[blockIdx].x + offsetX}px, ${BLOCKS[blockIdx].y + offsetY}px)`;
			el.style.opacity = '0';

			// Fade in with stagger
			scheduleTimer(() => {
				if (!el) return;
				el.style.transition = `opacity 200ms var(--ease-snappy)`;
				el.style.opacity = String(opacity);
			}, delay);
		}
	}, [scheduleTimer]);

	const applyAssemble = useCallback(() => {
		for (let i = 0; i < TOTAL_BLOCKS; i++) {
			const el = blockRefs.current[i];
			if (!el) continue;

			const delay = BLOCKS[i].index * ASSEMBLE_STAGGER;

			el.style.transition = `transform 500ms var(--ease-smooth) ${delay}ms, opacity 400ms var(--ease-smooth) ${delay}ms`;
			el.style.transform = `translate(${BLOCKS[i].x}px, ${BLOCKS[i].y}px)`;
			el.style.opacity = '1';
		}
	}, []);

	const applyScatter = useCallback(() => {
		for (let i = 0; i < TOTAL_BLOCKS; i++) {
			const el = blockRefs.current[i];
			if (!el) continue;

			const offsetX = randRange(-40, 40);
			const offsetY = randRange(-30, 30);

			el.style.transition = `transform 500ms var(--ease-snappy), opacity 400ms var(--ease-snappy)`;
			el.style.transform = `translate(${BLOCKS[i].x + offsetX}px, ${BLOCKS[i].y + offsetY}px)`;
			el.style.opacity = '0';
		}
	}, []);

	const runCycle = useCallback(() => {
		clearTimers();

		// Phase 1: Scramble
		applyScramble();

		// Phase 2: Assemble (after scramble completes)
		scheduleTimer(() => {
			applyAssemble();
		}, SCRAMBLE_DURATION);

		// Phase 3: Hold (implicit — just wait)
		// Phase 4: Scatter (after assemble + hold)
		scheduleTimer(() => {
			applyScatter();
		}, SCRAMBLE_DURATION + ASSEMBLE_DURATION + HOLD_DURATION);

		// Restart cycle
		scheduleTimer(() => {
			runCycle();
		}, SCRAMBLE_DURATION + ASSEMBLE_DURATION + HOLD_DURATION + SCATTER_DURATION);
	}, [clearTimers, scheduleTimer, applyScramble, applyAssemble, applyScatter]);

	useEffect(() => {
		if (reducedMotion) {
			// Static: show all blocks in place
			for (let i = 0; i < TOTAL_BLOCKS; i++) {
				const el = blockRefs.current[i];
				if (!el) continue;
				el.style.transition = 'none';
				el.style.transform = `translate(${BLOCKS[i].x}px, ${BLOCKS[i].y}px)`;
				el.style.opacity = '1';
			}
			return;
		}

		runCycle();
		return () => clearTimers();
	}, [reducedMotion, runCycle, clearTimers]);

	return (
		<div
			className="relative"
			style={{ width: GRID_WIDTH, height: GRID_HEIGHT }}
			aria-label="SOLO"
			role="img"
		>
			{BLOCKS.map((block, i) => (
				<div
					key={`${block.col}-${block.row}`}
					ref={(el) => { blockRefs.current[i] = el; }}
					className="absolute bg-primary rounded-[1px] will-change-[transform,opacity]"
					style={{
						width: BLOCK_SIZE,
						height: BLOCK_SIZE,
						transform: `translate(${block.x}px, ${block.y}px)`,
						opacity: 0,
					}}
				/>
			))}
		</div>
	);
};

// ─── Suggested Prompts ──────────────────────────────────────────────────────
const SUGGESTED_PROMPTS = [
	{ icon: Code, label: '> write code', prompt: 'Help me write a function that...' },
	{ icon: Lightning, label: '> fix a bug', prompt: 'I have a bug in my code where...' },
	{ icon: GitBranch, label: '> git help', prompt: 'Help me with my git workflow...' },
];

// ─── Composed Empty State ───────────────────────────────────────────────────
export const SoloEmptyState: FC<{
	onPromptClick: (prompt: string) => void;
}> = ({ onPromptClick }) => {
	const [showButtons, setShowButtons] = useState(false);

	// Show buttons after the first assemble phase completes (~2s)
	useEffect(() => {
		const timer = setTimeout(() => setShowButtons(true), SCRAMBLE_DURATION + ASSEMBLE_DURATION + 200);
		return () => clearTimeout(timer);
	}, []);

	return (
		<div className="flex flex-col items-center gap-0">
			{/* Decrypt animation */}
			<SoloDecryptAnimation />

			{/* Tagline */}
			<p className="text-xs text-muted-foreground/50 tracking-wide mt-4">
				Your AI coding agent
			</p>

			{/* Suggested prompts — stacked, terminal-style */}
			<div className="flex flex-col items-center gap-2 mt-6">
				{SUGGESTED_PROMPTS.map(({ icon: Icon, label, prompt }, i) => (
					<button
						key={label}
						onClick={() => onPromptClick(prompt)}
						className="h-9 w-full max-w-[240px] px-3.5 rounded-[10px] bg-muted/30 border border-border/30 font-mono text-xs text-muted-foreground hover:bg-muted/50 hover:border-border/50 hover:text-foreground hover:scale-[1.02] active:scale-[0.97] transition-all duration-200 flex items-center gap-2"
						style={{
							opacity: showButtons ? 1 : 0,
							transform: showButtons ? 'translateY(0)' : 'translateY(8px)',
							transition: 'opacity 200ms var(--ease-smooth), transform 200ms var(--ease-smooth)',
							transitionDelay: showButtons ? `${i * 60}ms` : '0ms',
						}}
					>
						<Icon className="w-3.5 h-3.5 text-primary/60 shrink-0" />
						<span>{label}</span>
					</button>
				))}
			</div>
		</div>
	);
};

export default SoloDecryptAnimation;
