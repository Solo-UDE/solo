import { useEffect, useRef, useCallback, useState } from 'react';
import { Bug, FolderOpen, GitBranch, Zap } from 'lucide-react';

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

// Animation phase durations — tuned so the intro (scramble → assemble)
// finishes at ~3.03s to match the startup sound duration.
// Visual completion: SCRAMBLE + (55 × ASSEMBLE_STAGGER) + 540ms transition = 3030ms
const SCRAMBLE_DURATION = 1500;
const ASSEMBLE_DURATION = 1530;
const HOLD_DURATION = 3000;
const SCATTER_DURATION = 600;

// Stagger delays
const SCRAMBLE_STAGGER = 24; // ms per block
const ASSEMBLE_STAGGER = 18; // ms per block

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

			el.style.transition = `transform 540ms var(--ease-smooth) ${delay}ms, opacity 440ms var(--ease-smooth) ${delay}ms`;
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
	{
		icon: Zap,
		label: 'Plan an implementation',
		prompt: 'Plan the cleanest way to implement this feature.',
		description: 'Break a feature into concrete steps before touching the code.',
	},
	{
		icon: Bug,
		label: 'Debug a failure',
		prompt: 'Debug this issue and tell me what to change.',
		description: 'Inspect logs, trace the problem, and move toward a real fix.',
	},
	{
		icon: FolderOpen,
		label: 'Inspect the repo',
		prompt: 'Map this codebase and explain the important pieces.',
		description: 'Understand structure, ownership, and where to work next.',
	},
];

// ─── Composed Empty State ───────────────────────────────────────────────────
export const SoloEmptyState: FC<{
	onPromptClick: (prompt: string) => void;
}> = ({ onPromptClick }) => {
	return (
		<div className="mx-auto w-full max-w-[56rem]">
			<div className="rounded-[28px] border border-border/70 bg-card/82 px-7 py-8 shadow-[0_28px_80px_-50px_rgba(0,0,0,0.35)] backdrop-blur-xl">
				<div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1 text-[11px] font-medium text-muted-foreground">
					<GitBranch className="h-3.5 w-3.5 text-primary" />
					New conversation
				</div>

				<h2 className="mt-5 text-[32px] font-semibold tracking-tight text-foreground">
					What should Solo work on?
				</h2>
				<p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
					Ask for code changes, debugging, repo exploration, terminal work, or a plan before implementation.
				</p>

				<div className="mt-7 grid gap-3 md:grid-cols-3">
					{SUGGESTED_PROMPTS.map(({ icon: Icon, label, prompt, description }) => (
					<button
						key={label}
						onClick={() => onPromptClick(prompt)}
						className="rounded-[20px] border border-border/60 bg-background/72 p-4 text-left hover:border-border hover:bg-card transition-[background-color,border-color,transform] duration-150 hover:-translate-y-0.5"
					>
						<div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[14px] border border-border/60 bg-card/85">
							<Icon className="h-4 w-4 text-primary" />
						</div>
						<p className="text-sm font-medium text-foreground">{label}</p>
						<p className="mt-1 text-xs leading-6 text-muted-foreground">{description}</p>
					</button>
				))}
				</div>
			</div>
		</div>
	);
};

export default SoloDecryptAnimation;
