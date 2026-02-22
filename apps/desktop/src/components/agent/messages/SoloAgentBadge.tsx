import type { FC } from 'react';

// 5x7 letter grids - each row is a 5-element array, 1 = filled block
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

const LETTER_A = [
	[0, 1, 1, 1, 0],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
	[1, 1, 1, 1, 1],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
];

const LETTER_G = [
	[0, 1, 1, 1, 0],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 0],
	[1, 0, 1, 1, 1],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
	[0, 1, 1, 1, 0],
];

const LETTER_E = [
	[1, 1, 1, 1, 1],
	[1, 0, 0, 0, 0],
	[1, 0, 0, 0, 0],
	[1, 1, 1, 1, 0],
	[1, 0, 0, 0, 0],
	[1, 0, 0, 0, 0],
	[1, 1, 1, 1, 1],
];

const LETTER_N = [
	[1, 0, 0, 0, 1],
	[1, 1, 0, 0, 1],
	[1, 0, 1, 0, 1],
	[1, 0, 0, 1, 1],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
	[1, 0, 0, 0, 1],
];

const LETTER_T = [
	[1, 1, 1, 1, 1],
	[0, 0, 1, 0, 0],
	[0, 0, 1, 0, 0],
	[0, 0, 1, 0, 0],
	[0, 0, 1, 0, 0],
	[0, 0, 1, 0, 0],
	[0, 0, 1, 0, 0],
];

// 1-col gap between letters within a word, 2-col gap between words
const LETTERS: { grid: number[][]; colOffset: number }[] = [
	{ grid: LETTER_S, colOffset: 0 },
	{ grid: LETTER_O, colOffset: 6 },
	{ grid: LETTER_L, colOffset: 12 },
	{ grid: LETTER_O, colOffset: 18 },
	// 4-col word gap
	{ grid: LETTER_A, colOffset: 27 },
	{ grid: LETTER_G, colOffset: 33 },
	{ grid: LETTER_E, colOffset: 39 },
	{ grid: LETTER_N, colOffset: 45 },
	{ grid: LETTER_T, colOffset: 51 },
];

// Compact scale: 1.28px blocks, 0.43px gaps (1.71px per cell)
const BLOCK_SIZE = 1.28;
const GAP = 0.43;
const CELL = BLOCK_SIZE + GAP;
const GRID_COLS = 56;
const GRID_ROWS = 7;
const GRID_WIDTH = GRID_COLS * CELL - GAP;
const GRID_HEIGHT = GRID_ROWS * CELL - GAP;

interface BlockPosition {
	col: number;
	row: number;
	x: number;
	y: number;
}

// Pre-compute block positions once at module init
const BLOCKS: BlockPosition[] = [];
for (const { grid, colOffset } of LETTERS) {
	for (let row = 0; row < 7; row++) {
		for (let col = 0; col < 5; col++) {
			if (grid[row][col] === 1) {
				BLOCKS.push({
					col: colOffset + col,
					row,
					x: (colOffset + col) * CELL,
					y: row * CELL,
				});
			}
		}
	}
}

export const SoloAgentBadge: FC = () => {
	return (
		<div
			className="inline-flex items-center"
			aria-label="SOLO Agent"
			role="img"
		>
			<div
				className="relative"
				style={{ width: GRID_WIDTH, height: GRID_HEIGHT }}
			>
				{BLOCKS.map((block) => (
					<div
						key={`${block.col}-${block.row}`}
						className="absolute bg-primary rounded-[0.5px]"
						style={{
							width: BLOCK_SIZE,
							height: BLOCK_SIZE,
							transform: `translate(${block.x}px, ${block.y}px)`,
						}}
					/>
				))}
			</div>
		</div>
	);
};
