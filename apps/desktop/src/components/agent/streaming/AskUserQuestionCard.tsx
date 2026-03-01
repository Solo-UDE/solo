/**
 * AskUserQuestionCard — Interactive form for AskUserQuestion tool calls.
 *
 * Renders structured questions with selectable options (radio/checkbox),
 * an "Other" free-text input, and a submit button that calls respondPermission
 * with the user's answers.
 */

import { type FC, useCallback, useState } from 'react';
import { ChatCircleDots, Check, PaperPlaneTilt } from '@phosphor-icons/react';
import { Button } from '@solo/ui';

interface QuestionOption {
	label: string;
	description?: string;
}

interface Question {
	question: string;
	header?: string;
	options: QuestionOption[];
	multiSelect?: boolean;
}

export interface AskUserQuestionCardProps {
	readonly requestId: string;
	readonly toolInput: unknown;
	readonly onSubmit?: (requestId: string, answers: Record<string, string>) => void;
	readonly onReject?: (requestId: string) => void;
	readonly className?: string;
}

/** Safely extract the questions array from toolInput */
const parseQuestions = (toolInput: unknown): Question[] => {
	if (typeof toolInput !== 'object' || toolInput === null) return [];
	const input = toolInput as Record<string, unknown>;
	const questions = input['questions'];
	if (!Array.isArray(questions)) return [];
	return questions.filter(
		(q): q is Question =>
			typeof q === 'object' &&
			q !== null &&
			typeof (q as Question).question === 'string' &&
			Array.isArray((q as Question).options),
	);
};

export const AskUserQuestionCard: FC<AskUserQuestionCardProps> = ({
	requestId,
	toolInput,
	onSubmit,
	onReject,
	className = '',
}) => {
	const questions = parseQuestions(toolInput);
	// Track selected options per question (question text -> selected labels)
	const [selections, setSelections] = useState<Map<string, Set<string>>>(new Map());
	// Track "Other" text per question
	const [otherText, setOtherText] = useState<Map<string, string>>(new Map());
	const [submitted, setSubmitted] = useState(false);

	const toggleOption = useCallback(
		(questionText: string, label: string, multiSelect: boolean) => {
			setSelections((prev) => {
				const next = new Map(prev);
				const current = new Set(next.get(questionText) ?? []);

				if (multiSelect) {
					if (current.has(label)) current.delete(label);
					else current.add(label);
				} else {
					current.clear();
					current.add(label);
				}

				// Deselect "Other" if a regular option is chosen (single-select only)
				if (!multiSelect) {
					setOtherText((prevOther) => {
						const nextOther = new Map(prevOther);
						nextOther.delete(questionText);
						return nextOther;
					});
				}

				next.set(questionText, current);
				return next;
			});
		},
		[],
	);

	const setOther = useCallback((questionText: string, text: string) => {
		setOtherText((prev) => {
			const next = new Map(prev);
			next.set(questionText, text);
			return next;
		});
		// In single-select mode, clear regular selections when typing Other
		setSelections((prev) => {
			const next = new Map(prev);
			next.delete(questionText);
			return next;
		});
	}, []);

	const handleSubmit = useCallback(() => {
		if (submitted) return;
		setSubmitted(true);

		const answers: Record<string, string> = {};
		for (const q of questions) {
			const selected = selections.get(q.question);
			const other = otherText.get(q.question);
			if (other?.trim()) {
				answers[q.question] = other.trim();
			} else if (selected && selected.size > 0) {
				answers[q.question] = Array.from(selected).join(', ');
			}
		}

		onSubmit?.(requestId, answers);
	}, [submitted, questions, selections, otherText, requestId, onSubmit]);

	if (questions.length === 0) return null;

	return (
		<div
			className={`my-2 rounded-xl bg-primary/5 backdrop-blur-sm border border-primary/20 overflow-hidden flex flex-col max-h-[70vh] animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ${className}`}
			role="form"
			aria-label="Agent question"
		>
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2.5 border-b border-primary/10">
				<ChatCircleDots className="h-4 w-4 text-primary shrink-0" weight="fill" />
				<span className="text-xs font-semibold text-primary">Question</span>
			</div>

			{/* Questions */}
			<div className="p-3 space-y-4 overflow-y-auto flex-1 min-h-0">
				{questions.map((q, qi) => {
					const selectedSet = selections.get(q.question) ?? new Set<string>();
					const otherValue = otherText.get(q.question) ?? '';
					const hasOther = otherValue.trim().length > 0;

					return (
						<div key={`q-${String(qi)}`} className="space-y-2">
							{/* Question header chip */}
							{q.header ? (
								<span className="inline-block text-[10px] font-medium uppercase tracking-wider text-primary/70 bg-primary/10 px-2 py-0.5 rounded-md">
									{q.header}
								</span>
							) : null}

							{/* Question text */}
							<p className="text-sm text-foreground font-medium">{q.question}</p>

							{/* Options */}
							<div className="space-y-1.5">
								{q.options.map((opt, oi) => {
									const isSelected = selectedSet.has(opt.label) && !hasOther;
									return (
										<button
											key={`opt-${String(qi)}-${String(oi)}`}
											type="button"
											onClick={() => toggleOption(q.question, opt.label, !!q.multiSelect)}
											disabled={submitted}
											className={`w-full text-left px-3 py-2 rounded-lg border transition-all duration-150 ${
												isSelected
													? 'border-primary/40 bg-primary/10 text-foreground'
													: 'border-border/30 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:border-border/50'
											} disabled:opacity-50 disabled:cursor-not-allowed`}
										>
											<div className="flex items-start gap-2">
												{/* Checkbox / Radio indicator */}
												<div
													className={`mt-0.5 flex items-center justify-center shrink-0 ${
														q.multiSelect
															? 'w-4 h-4 rounded-[4px] border'
															: 'w-4 h-4 rounded-full border'
													} ${
														isSelected
															? 'border-primary bg-primary'
															: 'border-muted-foreground/40'
													}`}
												>
													{isSelected ? (
														<Check weight="bold" className="w-2.5 h-2.5 text-primary-foreground" />
													) : null}
												</div>
												<div className="flex-1 min-w-0">
													<span className="text-xs font-medium">{opt.label}</span>
													{opt.description ? (
														<p className="text-[11px] text-muted-foreground/70 mt-0.5">{opt.description}</p>
													) : null}
												</div>
											</div>
										</button>
									);
								})}

								{/* "Other" option */}
								<div
									className={`px-3 py-2 rounded-lg border transition-all duration-150 ${
										hasOther
											? 'border-primary/40 bg-primary/10'
											: 'border-border/30 bg-muted/20'
									}`}
								>
									<div className="flex items-center gap-2">
										<div
											className={`flex items-center justify-center shrink-0 ${
												q.multiSelect
													? 'w-4 h-4 rounded-[4px] border'
													: 'w-4 h-4 rounded-full border'
											} ${
												hasOther
													? 'border-primary bg-primary'
													: 'border-muted-foreground/40'
											}`}
										>
											{hasOther ? (
												<Check weight="bold" className="w-2.5 h-2.5 text-primary-foreground" />
											) : null}
										</div>
										<input
											type="text"
											placeholder="Other..."
											value={otherValue}
											onChange={(e) => setOther(q.question, e.target.value)}
											disabled={submitted}
											className="flex-1 text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground/50 disabled:opacity-50"
										/>
									</div>
								</div>
							</div>
						</div>
					);
				})}
			</div>

			{/* Actions */}
			<div className="flex items-center justify-end gap-2 px-3 pb-3">
				{onReject ? (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onReject(requestId)}
						disabled={submitted}
						className="h-7 px-2.5 text-xs"
					>
						Skip
					</Button>
				) : null}
				<Button
					variant="primary"
					size="sm"
					onClick={handleSubmit}
					disabled={submitted}
					className="h-7 px-3 text-xs"
				>
					{submitted ? (
						<>
							<Check className="h-3 w-3" weight="bold" />
							Submitted
						</>
					) : (
						<>
							<PaperPlaneTilt className="h-3 w-3" weight="fill" />
							Submit
						</>
					)}
				</Button>
			</div>
		</div>
	);
};
