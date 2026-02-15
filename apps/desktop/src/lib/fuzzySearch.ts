/**
 * Lightweight fuzzy file search utility
 * Subsequence-based matching with scoring for consecutive matches and path boundaries.
 */

export interface FileSearchResult {
	path: string;
	name: string;
	relativePath: string;
	score: number;
}

export interface FileEntry {
	path: string;
	name: string;
	relativePath: string;
}

/**
 * Fuzzy search files by query against their relative paths and names.
 * Returns top results sorted by relevance score.
 */
export function fuzzySearchFiles(
	query: string,
	files: FileEntry[],
	limit = 20
): FileSearchResult[] {
	if (!query) {
		return files.slice(0, limit).map((f) => ({ ...f, score: 0 }));
	}

	const lowerQuery = query.toLowerCase();
	const scored: FileSearchResult[] = [];

	for (const file of files) {
		// Score against both filename and relative path, take the best
		const nameScore = fuzzyScore(lowerQuery, file.name.toLowerCase());
		const pathScore = fuzzyScore(lowerQuery, file.relativePath.toLowerCase());
		const bestScore = Math.max(nameScore * 1.5, pathScore); // Boost filename matches

		if (bestScore > 0) {
			scored.push({ ...file, score: bestScore });
		}
	}

	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit);
}

/**
 * Subsequence fuzzy scoring with bonuses for:
 * - Consecutive character matches
 * - Matches at word boundaries (after /, \, ., -, _)
 * - Matches at the start of the string
 */
function fuzzyScore(query: string, target: string): number {
	if (query.length === 0) return 0;
	if (query.length > target.length) return 0;

	let qi = 0;
	let score = 0;
	let consecutive = 0;

	for (let ti = 0; ti < target.length && qi < query.length; ti++) {
		if (target[ti] === query[qi]) {
			qi++;
			consecutive++;
			score += consecutive; // Consecutive match bonus

			// Word boundary bonus
			if (
				ti === 0 ||
				target[ti - 1] === '/' ||
				target[ti - 1] === '\\' ||
				target[ti - 1] === '.' ||
				target[ti - 1] === '-' ||
				target[ti - 1] === '_'
			) {
				score += 5;
			}
		} else {
			consecutive = 0;
		}
	}

	// Return 0 if not all query chars were matched
	return qi === query.length ? score : 0;
}
