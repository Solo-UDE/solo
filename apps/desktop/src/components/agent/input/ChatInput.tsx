import { useState, useCallback } from 'react';
import { PaperPlaneTilt, Brain, Lightning, CaretDown, GitBranch } from '@phosphor-icons/react';

import type { FC, KeyboardEvent } from 'react';
import type { MessageMode } from '../../../stores/agentStore';
import type { WorktreeInfo } from '../../../bindings';

export interface ChatInputProps {
	onSubmit: (content: string) => void;
	isDisabled?: boolean;
	mode?: MessageMode;
	onModeChange?: (mode: MessageMode) => void;
	selectedModel?: string | null;
	onModelChange?: (model: string) => void;
	worktrees?: WorktreeInfo[];
	activeWorktreeId?: string | null;
	onWorktreeChange?: (id: string | null) => void;
	placeholder?: string;
	className?: string;
}

export const ChatInput: FC<ChatInputProps> = ({
	onSubmit,
	isDisabled = false,
	mode = 'planning',
	onModeChange,
	selectedModel,
	onModelChange,
	worktrees,
	activeWorktreeId,
	onWorktreeChange,
	placeholder = 'Type a message...',
	className = '',
}) => {
	const [content, setContent] = useState('');
	const [showModeMenu, setShowModeMenu] = useState(false);
	const [showModelMenu, setShowModelMenu] = useState(false);
	const [showWorktreeMenu, setShowWorktreeMenu] = useState(false);

	const handleSubmit = useCallback(() => {
		if (content.trim() && !isDisabled) {
			onSubmit(content);
			setContent('');
		}
	}, [content, isDisabled, onSubmit]);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				handleSubmit();
			}
		},
		[handleSubmit]
	);

	const modeConfig = {
		planning: {
			label: 'Planning',
			icon: Brain,
			description: 'Thoughtful approach',
		},
		fast: {
			label: 'Fast',
			icon: Lightning,
			description: 'Quick responses',
		},
	};

	const ModeIcon = modeConfig[mode].icon;

	return (
		<div className={`border-t border-border bg-background ${className}`}>
			<div className="max-w-4xl mx-auto p-4">
				{/* Text input */}
				<div className="mb-3">
					<textarea
						value={content}
						onChange={(e) => setContent(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder={placeholder}
						disabled={isDisabled}
						className={`
							w-full min-h-[80px] max-h-[200px]
							px-4 py-3 rounded-lg
							border border-border bg-background
							text-sm text-foreground
							placeholder:text-muted-foreground
							focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent
							resize-none
							${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
						`}
					/>
				</div>

				{/* Bottom controls */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						{/* Mode selector */}
						{onModeChange && (
							<div className="relative">
								<button
									onClick={() => setShowModeMenu(!showModeMenu)}
									disabled={isDisabled}
									className={`
										inline-flex items-center gap-2
										px-3 py-1.5 rounded-md
										border border-border bg-background
										hover:bg-muted
										transition-colors
										${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
									`}
								>
									<ModeIcon className="h-4 w-4 text-foreground" />
									<span className="text-sm font-medium text-foreground">
										{modeConfig[mode].label}
									</span>
									<CaretDown className="h-3 w-3 text-muted-foreground" />
								</button>
								{showModeMenu && (
									<div className="absolute bottom-full left-0 mb-1 w-48 py-1 rounded-md border border-border bg-background shadow-lg z-10">
										{Object.entries(modeConfig).map(([key, config]) => {
											const Icon = config.icon;
											return (
												<button
													key={key}
													onClick={() => {
														onModeChange(key as MessageMode);
														setShowModeMenu(false);
													}}
													className={`
														w-full flex items-start gap-3 px-3 py-2
														hover:bg-muted
														${mode === key ? 'bg-primary/10' : ''}
													`}
												>
													<Icon className="h-4 w-4 mt-0.5 text-foreground" />
													<div className="flex flex-col items-start">
														<span className="text-sm font-medium">{config.label}</span>
														<span className="text-xs text-muted-foreground">
															{config.description}
														</span>
													</div>
												</button>
											);
										})}
									</div>
								)}
							</div>
						)}

						{/* Model selector */}
						{onModelChange && selectedModel && (
							<div className="relative">
								<button
									onClick={() => setShowModelMenu(!showModelMenu)}
									disabled={isDisabled}
									className={`
										inline-flex items-center gap-2
										px-3 py-1.5 rounded-md
										border border-border bg-background
										hover:bg-muted
										transition-colors
										${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
									`}
								>
									<span className="text-sm font-medium text-foreground truncate max-w-[120px]">
										{getModelDisplayName(selectedModel)}
									</span>
									<CaretDown className="h-3 w-3 text-muted-foreground" />
								</button>
								{showModelMenu && (
									<ModelMenu
										selectedModel={selectedModel}
										onSelect={(model) => {
											onModelChange(model);
											setShowModelMenu(false);
										}}
										onClose={() => setShowModelMenu(false)}
									/>
								)}
							</div>
						)}

						{/* Worktree selector */}
						{onWorktreeChange && worktrees && worktrees.length > 0 && (
							<div className="relative">
								<button
									onClick={() => setShowWorktreeMenu(!showWorktreeMenu)}
									disabled={isDisabled}
									className={`
										inline-flex items-center gap-2
										px-3 py-1.5 rounded-md
										border border-border bg-background
										hover:bg-muted
										transition-colors
										${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
									`}
								>
									<GitBranch className="h-4 w-4 text-foreground" />
									<span className="text-sm font-medium text-foreground truncate max-w-[120px]">
										{activeWorktreeId
											? worktrees.find((wt) => wt.id === activeWorktreeId)?.branch ?? activeWorktreeId
											: 'main'}
									</span>
									<CaretDown className="h-3 w-3 text-muted-foreground" />
								</button>
								{showWorktreeMenu && (
									<div className="absolute bottom-full left-0 mb-1 w-64 py-1 rounded-md border border-border bg-background shadow-lg z-10">
										<button
											onClick={() => {
												onWorktreeChange(null);
												setShowWorktreeMenu(false);
											}}
											className={`
												w-full flex flex-col items-start px-3 py-2
												hover:bg-muted
												${!activeWorktreeId ? 'bg-primary/10' : ''}
											`}
										>
											<span className="text-sm font-medium">main</span>
											<span className="text-xs text-muted-foreground">Primary workspace</span>
										</button>
										{worktrees
											.filter((wt) => !wt.is_main)
											.map((wt) => (
												<button
													key={wt.id}
													onClick={() => {
														onWorktreeChange(wt.id);
														setShowWorktreeMenu(false);
													}}
													className={`
														w-full flex flex-col items-start px-3 py-2
														hover:bg-muted
														${activeWorktreeId === wt.id ? 'bg-primary/10' : ''}
													`}
												>
													<span className="text-sm font-medium">{wt.branch ?? wt.id}</span>
													<span className="text-xs text-muted-foreground">
														{wt.is_dirty ? 'Modified' : 'Clean'}
														{wt.is_locked ? ' (locked)' : ''}
													</span>
												</button>
											))}
									</div>
								)}
							</div>
						)}
					</div>

					{/* Submit button */}
					<button
						onClick={handleSubmit}
						disabled={isDisabled || !content.trim()}
						className={`
							inline-flex items-center gap-2
							px-4 py-2 rounded-md
							bg-primary text-primary-foreground
							hover:brightness-110
							active:scale-[0.97]
							transition-all duration-200
							${isDisabled || !content.trim() ? 'opacity-50 cursor-not-allowed' : ''}
						`}
					>
						<PaperPlaneTilt className="h-4 w-4" />
						<span className="text-sm font-medium">Send</span>
					</button>
				</div>
			</div>
		</div>
	);
};

// Helper function to get display name from model ID
function getModelDisplayName(modelId: string): string {
	const displayNames: Record<string, string> = {
		'claude-sonnet-4-20250514': 'Sonnet 4',
		'claude-opus-4-20250514': 'Opus 4',
		'claude-3-5-haiku-latest': 'Haiku 3.5',
		'gpt-4.1': 'GPT-4.1',
		'gpt-4.1-mini': 'GPT-4.1 Mini',
		'gpt-4o': 'GPT-4o',
	};
	return displayNames[modelId] || modelId;
}

// Model selection menu
interface ModelMenuProps {
	selectedModel: string;
	onSelect: (model: string) => void;
	onClose: () => void;
}

const ModelMenu: FC<ModelMenuProps> = ({ selectedModel, onSelect, onClose: _onClose }) => {
	const models = [
		{ id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', description: 'Balanced speed and intelligence' },
		{ id: 'claude-opus-4-20250514', name: 'Claude Opus 4', description: 'Most capable' },
		{ id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', description: 'Fast and efficient' },
	];

	return (
		<div className="absolute bottom-full left-0 mb-1 w-64 py-1 rounded-md border border-border bg-background shadow-lg z-10">
			{models.map((model) => (
				<button
					key={model.id}
					onClick={() => onSelect(model.id)}
					className={`
						w-full flex flex-col items-start px-3 py-2
						hover:bg-muted
						${selectedModel === model.id ? 'bg-primary/10' : ''}
					`}
				>
					<span className="text-sm font-medium">{model.name}</span>
					<span className="text-xs text-muted-foreground">{model.description}</span>
				</button>
			))}
		</div>
	);
};
