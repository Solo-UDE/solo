import { describe, it, expect } from 'bun:test';
import { pickWorktreeName, DEFAULT_BRANCH_PREFIX } from './worktreeNaming';
import type { WorktreeInfo } from '../bindings';

function wt(branch: string): WorktreeInfo {
	return {
		id: branch,
		path: `/tmp/${branch}`,
		branch,
		head_sha: '0000000000000000000000000000000000000000',
		is_main: false,
		is_locked: false,
		lock_reason: null,
		is_dirty: false,
		agent_session_id: null,
		created_at: 0n as unknown as bigint,
		exists_on_disk: true,
	} as unknown as WorktreeInfo;
}

describe('pickWorktreeName', () => {
	it('defaults to the solo/ prefix and tier-1 pool for a fresh user', () => {
		const { branch, poolName } = pickWorktreeName(1, [], { random: () => 0 });
		expect(branch.startsWith(`${DEFAULT_BRANCH_PREFIX}/`)).toBe(true);
		expect(branch).toBe(`${DEFAULT_BRANCH_PREFIX}/${poolName.toLowerCase()}`);
	});

	it('strips the prefix when matching already-used names (case-insensitive)', () => {
		const existing = [wt('solo/sequoia'), wt('solo/cypress')];
		const { poolName } = pickWorktreeName(1, existing, { random: () => 0 });
		expect(['sequoia', 'cypress']).not.toContain(poolName.toLowerCase());
	});

	it('honors a custom prefix', () => {
		const { branch } = pickWorktreeName(1, [], {
			prefix: 'sachin',
			random: () => 0,
		});
		expect(branch.startsWith('sachin/')).toBe(true);
	});

	it('emits a segment-only branch when the prefix is empty', () => {
		const { branch } = pickWorktreeName(1, [], {
			prefix: '',
			random: () => 0,
		});
		expect(branch.includes('/')).toBe(false);
	});

	it('ignores worktrees whose branch is null', () => {
		const mainLike = wt('main');
		(mainLike as unknown as { branch: string | null }).branch = null;
		const { branch } = pickWorktreeName(1, [mainLike], { random: () => 0 });
		expect(branch.startsWith(`${DEFAULT_BRANCH_PREFIX}/`)).toBe(true);
	});
});
