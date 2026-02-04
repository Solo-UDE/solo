import { useState, useCallback } from 'react';
import { X, Key, Eye, EyeSlash, CircleNotch } from '@phosphor-icons/react';

import { useProviderStore } from '../../../stores/provider-store';

import type { FC } from 'react';
import type { ProviderType } from '../../../bindings';

export interface ApiKeyDialogProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess?: () => void;
	provider?: ProviderType;
}

export const ApiKeyDialog: FC<ApiKeyDialogProps> = ({
	isOpen,
	onClose,
	onSuccess,
	provider = 'anthropic',
}) => {
	const [apiKey, setApiKey] = useState('');
	const [showKey, setShowKey] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const setCredentials = useProviderStore((state) => state.setCredentials);

	const handleSubmit = useCallback(async () => {
		if (!apiKey.trim()) {
			setError('Please enter an API key');
			return;
		}

		setIsSubmitting(true);
		setError(null);

		try {
			await setCredentials(provider, apiKey);
			setApiKey('');
			// Call onSuccess if provided, otherwise fall back to onClose
			if (onSuccess) {
				onSuccess();
			} else {
				onClose();
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to save API key');
		} finally {
			setIsSubmitting(false);
		}
	}, [apiKey, provider, setCredentials, onClose, onSuccess]);

	if (!isOpen) return null;

	const providerName = provider === 'anthropic' ? 'Anthropic (Claude)' : 'OpenAI';
	const apiKeyPlaceholder = provider === 'anthropic' ? 'sk-ant-...' : 'sk-...';

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center">
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/50 backdrop-blur-sm"
				onClick={onClose}
			/>

			{/* Dialog */}
			<div className="relative w-full max-w-md mx-4 bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
				{/* Header */}
				<div className="flex items-center justify-between px-6 py-4 border-b border-border">
					<div className="flex items-center gap-3">
						<div className="p-2 rounded-lg bg-primary/10">
							<Key className="w-5 h-5 text-primary" />
						</div>
						<div>
							<h2 className="text-lg font-semibold text-foreground">
								Add API Key
							</h2>
							<p className="text-sm text-muted-foreground">{providerName}</p>
						</div>
					</div>
					<button
						onClick={onClose}
						className="p-1.5 rounded-md hover:bg-muted/60 transition-colors"
					>
						<X className="w-4 h-4 text-muted-foreground" />
					</button>
				</div>

				{/* Body */}
				<div className="px-6 py-4 space-y-4">
					<p className="text-sm text-muted-foreground">
						Enter your {providerName} API key. It will be stored securely in your
						system keychain.
					</p>

					{/* API Key input */}
					<div className="space-y-2">
						<label className="block text-sm font-medium text-foreground">
							API Key
						</label>
						<div className="relative">
							<input
								type={showKey ? 'text' : 'password'}
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder={apiKeyPlaceholder}
								className={`
									w-full px-4 py-2.5 pr-10 rounded-lg
									border border-border bg-muted/40
									text-sm text-foreground
									placeholder:text-muted-foreground
									focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent
									${error ? 'border-destructive' : ''}
								`}
							/>
							<button
								type="button"
								onClick={() => setShowKey(!showKey)}
								className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted/60"
							>
								{showKey ? (
									<EyeSlash className="w-4 h-4 text-muted-foreground" />
								) : (
									<Eye className="w-4 h-4 text-muted-foreground" />
								)}
							</button>
						</div>
						{error && <p className="text-sm text-destructive">{error}</p>}
					</div>

					{/* Info text */}
					<div className="p-3 rounded-lg bg-muted/30 border border-border/50">
						<p className="text-xs text-muted-foreground">
							Your API key is stored locally in your system's secure keychain and
							never sent to our servers. All API calls go directly to{' '}
							{providerName}.
						</p>
					</div>
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
					<button
						onClick={onClose}
						className="px-4 py-2 rounded-lg text-sm font-medium text-foreground hover:bg-muted/60 transition-colors"
					>
						Cancel
					</button>
					<button
						onClick={handleSubmit}
						disabled={isSubmitting || !apiKey.trim()}
						className={`
							inline-flex items-center gap-2 px-4 py-2 rounded-lg
							bg-primary text-primary-foreground
							text-sm font-medium
							hover:brightness-110 active:scale-[0.97]
							transition-all duration-200
							${isSubmitting || !apiKey.trim() ? 'opacity-50 cursor-not-allowed' : ''}
						`}
					>
						{isSubmitting && <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />}
						{isSubmitting ? 'Saving...' : 'Save API Key'}
					</button>
				</div>
			</div>
		</div>
	);
};
