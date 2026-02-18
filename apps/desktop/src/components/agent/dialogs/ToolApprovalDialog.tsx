import { useCallback } from 'react';
import { ShieldCheck, X } from '@phosphor-icons/react';

import type { FC } from 'react';
import type { ToolCallWithStatus } from '../../../bindings';

export interface ToolApprovalDialogProps {
	approvals: ToolCallWithStatus[];
	sessionId: string | null;
	onResolve: (sessionId: string, toolCallId: string, approved: boolean) => void;
}

/** Tool name → human-friendly description */
const TOOL_DESCRIPTIONS: Record<string, string> = {
	write: 'Write to a file',
	edit: 'Edit a file',
	bash: 'Run a shell command',
};

/**
 * Floating approval bar that appears at the bottom of the agent window
 * when tools requiring user consent are pending.
 */
export const ToolApprovalDialog: FC<ToolApprovalDialogProps> = ({
	approvals,
	sessionId,
	onResolve,
}) => {
	const handleApprove = useCallback(
		(toolCallId: string) => {
			if (sessionId) onResolve(sessionId, toolCallId, true);
		},
		[sessionId, onResolve]
	);

	const handleReject = useCallback(
		(toolCallId: string) => {
			if (sessionId) onResolve(sessionId, toolCallId, false);
		},
		[sessionId, onResolve]
	);

	const handleApproveAll = useCallback(() => {
		if (!sessionId) return;
		for (const a of approvals) {
			onResolve(sessionId, a.tool_call.id, true);
		}
	}, [sessionId, approvals, onResolve]);

	if (approvals.length === 0 || !sessionId) return null;

	// Parse tool args for display
	const parseArgs = (args: string): Record<string, unknown> => {
		try {
			return JSON.parse(args);
		} catch {
			return {};
		}
	};

	return (
		<div className="mx-3 mb-2 rounded-xl bg-card/95 backdrop-blur-md shadow-[0_8px_32px_-8px_rgba(0,0,0,0.25)] border border-border/30 overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between px-3.5 py-2 border-b border-border/20">
				<div className="flex items-center gap-2">
					<ShieldCheck className="w-4 h-4 text-primary" weight="duotone" />
					<span className="text-xs font-medium text-foreground">
						{approvals.length === 1 ? 'Tool approval needed' : `${approvals.length} tools need approval`}
					</span>
				</div>
				{approvals.length > 1 && (
					<button
						onClick={handleApproveAll}
						className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors duration-150"
					>
						Approve all
					</button>
				)}
			</div>

			{/* Tool list */}
			<div className="max-h-48 overflow-y-auto">
				{approvals.map((approval) => {
					const args = parseArgs(approval.tool_call.arguments);
					const desc = TOOL_DESCRIPTIONS[approval.tool_call.name] || approval.tool_call.name;
					const detail =
						(args.path as string) ||
						(args.command as string) ||
						'';

					return (
						<div
							key={approval.tool_call.id}
							className="flex items-center gap-3 px-3.5 py-2.5 border-b border-border/10 last:border-b-0"
						>
							{/* Info */}
							<div className="flex-1 min-w-0">
								<div className="text-xs font-medium text-foreground">{desc}</div>
								{detail && (
									<div className="text-[11px] text-muted-foreground truncate mt-0.5">
										{detail}
									</div>
								)}
							</div>

							{/* Actions */}
							<div className="flex items-center gap-1.5 shrink-0">
								<button
									onClick={() => handleReject(approval.tool_call.id)}
									className="h-7 px-2.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all duration-150"
								>
									<X className="w-3.5 h-3.5" />
								</button>
								<button
									onClick={() => handleApprove(approval.tool_call.id)}
									className="h-7 px-3 rounded-lg text-[11px] font-medium bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.97] transition-all duration-150"
								>
									Approve
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
};
