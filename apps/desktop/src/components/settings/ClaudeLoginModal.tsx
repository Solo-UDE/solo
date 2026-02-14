/**
 * ClaudeLoginModal - Modal to authenticate via Claude Code CLI
 * Checks if CLI is installed, guides installation if needed, then authenticates
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, CircleNotch, WarningCircle, Terminal, ArrowsClockwise, DownloadSimple, Copy, Check } from '@phosphor-icons/react';
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from '../ui/dialog';
import {
	startClaudeLogin,
	checkClaudeAuthStatus,
	checkClaudeCliInstalled,
	installClaudeCli,
} from '../../lib/backend';

interface ClaudeLoginModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSuccess: () => void;
}

type Step = 'checking' | 'not-installed' | 'installing' | 'ready' | 'waiting' | 'complete' | 'error';

export function ClaudeLoginModal({ isOpen, onClose, onSuccess }: ClaudeLoginModalProps) {
	const [step, setStep] = useState<Step>('checking');
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);

	const checkAuth = useCallback(async () => {
		setStep('checking');
		setError(null);

		try {
			const isAuthenticated = await checkClaudeAuthStatus();
			if (isAuthenticated) {
				setStep('complete');
				setTimeout(() => {
					onSuccess();
					onClose();
				}, 1500);
				return;
			}

			const isInstalled = await checkClaudeCliInstalled();
			if (!isInstalled) {
				setStep('not-installed');
			} else {
				setStep('ready');
			}
		} catch (err) {
			setError(String(err));
			setStep('error');
		}
	}, [onSuccess, onClose]);

	useEffect(() => {
		if (isOpen) {
			checkAuth();
		} else {
			setStep('checking');
			setError(null);
			setCopied(false);
		}
	}, [isOpen, checkAuth]);

	const handleInstall = useCallback(async () => {
		setStep('installing');
		setError(null);

		try {
			await installClaudeCli();
			setStep('ready');
		} catch (err) {
			setError(String(err));
			setStep('error');
		}
	}, []);

	const handleCopyInstallCommand = useCallback(async () => {
		try {
			await navigator.clipboard.writeText('npm install -g @anthropic-ai/claude-code');
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard API may not be available
		}
	}, []);

	const handleOpenTerminal = useCallback(async () => {
		setStep('waiting');
		setError(null);

		try {
			await startClaudeLogin();
		} catch (err) {
			setError(String(err));
			setStep('error');
		}
	}, []);

	const handleVerify = useCallback(async () => {
		setStep('checking');
		setError(null);

		try {
			const isAuthenticated = await checkClaudeAuthStatus();
			if (isAuthenticated) {
				setStep('complete');
				setTimeout(() => {
					onSuccess();
					onClose();
				}, 1500);
			} else {
				setError('No credentials found. Please complete the login in Terminal first.');
				setStep('waiting');
			}
		} catch (err) {
			setError(String(err));
			setStep('error');
		}
	}, [onSuccess, onClose]);

	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				showCloseButton={true}
				className="sm:max-w-[420px] w-[420px] p-0 overflow-hidden"
			>
				{/* Header */}
				<div className="flex items-center gap-2.5 px-5 py-4 border-b border-border">
					<Terminal className="w-4 h-4 text-muted-foreground" />
					<DialogTitle className="text-sm font-medium text-foreground">Sign in with Claude</DialogTitle>
				</div>

				{/* Body */}
				<div className="p-5 space-y-4">
					{step === 'checking' && (
						<div className="flex flex-col items-center justify-center gap-3 py-6">
							<CircleNotch weight="bold" className="w-6 h-6 text-primary animate-spin" />
							<p className="text-sm text-muted-foreground">Checking authentication...</p>
						</div>
					)}

					{step === 'not-installed' && (
						<>
							<p className="text-sm text-foreground">
								Claude Code CLI is required to sign in with your Claude account.
							</p>
							<p className="text-xs text-muted-foreground">
								Claude Pro and Max subscribers get API access through the Claude Code CLI. Solo will automatically detect your credentials after you sign in.
							</p>

							{/* Install command display */}
							<div className="flex items-center gap-2 p-2.5 bg-muted/40 rounded-none font-mono text-xs">
								<code className="flex-1 text-foreground select-all">npm install -g @anthropic-ai/claude-code</code>
								<button
									type="button"
									onClick={handleCopyInstallCommand}
									className="p-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
									title="Copy command"
								>
									{copied ? (
										<Check className="w-3.5 h-3.5 text-green-500" />
									) : (
										<Copy className="w-3.5 h-3.5" />
									)}
								</button>
							</div>

							<button
								type="button"
								onClick={handleInstall}
								className="w-full h-10 px-4 bg-primary text-primary-foreground rounded-none text-sm font-medium hover:brightness-110 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
							>
								<DownloadSimple className="w-4 h-4" />
								Install Claude Code
							</button>

							<div className="flex items-center gap-2">
								<div className="flex-1 h-px bg-border" />
								<span className="text-xs text-muted-foreground">or</span>
								<div className="flex-1 h-px bg-border" />
							</div>

							<button
								type="button"
								onClick={() => setStep('ready')}
								className="w-full h-9 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-none text-xs font-medium active:scale-[0.98] transition-all duration-200"
							>
								I already installed it — continue
							</button>
						</>
					)}

					{step === 'installing' && (
						<div className="flex flex-col items-center justify-center gap-3 py-6">
							<CircleNotch weight="bold" className="w-6 h-6 text-primary animate-spin" />
							<p className="text-sm text-muted-foreground">Installing Claude Code CLI...</p>
							<p className="text-xs text-muted-foreground">This may take a moment</p>
						</div>
					)}

					{step === 'ready' && (
						<>
							<p className="text-sm text-foreground">
								Sign in with your Claude account to use your subscription for API access.
							</p>
							<p className="text-xs text-muted-foreground">
								The Claude Code CLI will open in Terminal. Follow the prompts to authenticate, then come back and click "Verify".
							</p>
							<button
								type="button"
								onClick={handleOpenTerminal}
								className="w-full h-10 px-4 bg-primary text-primary-foreground rounded-none text-sm font-medium hover:brightness-110 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
							>
								<Terminal className="w-4 h-4" />
								Open Terminal
							</button>
						</>
					)}

					{step === 'waiting' && (
						<>
							<div className="p-4 bg-muted/40 rounded-none space-y-2">
								<p className="text-sm text-foreground font-medium">Complete login in Terminal</p>
								<ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
									<li>A Terminal window opened with Claude</li>
									<li>Follow the prompts to sign in</li>
									<li>Once complete, click "Verify" below</li>
								</ol>
							</div>

							{error && (
								<div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-none">
									<WarningCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
									<p className="text-xs text-destructive">{error}</p>
								</div>
							)}

							<div className="flex gap-2">
								<button
									type="button"
									onClick={handleOpenTerminal}
									className="flex-1 h-10 px-4 bg-muted hover:bg-muted/80 text-foreground rounded-none text-sm font-medium active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
								>
									<Terminal className="w-4 h-4" />
									Reopen Terminal
								</button>
								<button
									type="button"
									onClick={handleVerify}
									className="flex-1 h-10 px-4 bg-primary text-primary-foreground rounded-none text-sm font-medium hover:brightness-110 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
								>
									<CheckCircle className="w-4 h-4" />
									Verify
								</button>
							</div>
						</>
					)}

					{step === 'complete' && (
						<div className="flex flex-col items-center justify-center gap-3 py-6">
							<CheckCircle className="w-8 h-8 text-green-500" />
							<div className="text-center">
								<p className="text-sm font-medium text-green-600">Successfully authenticated!</p>
								<p className="text-xs text-muted-foreground mt-1">You can now use Claude in Solo</p>
							</div>
						</div>
					)}

					{step === 'error' && (
						<>
							<div className="flex items-start gap-2 p-4 bg-destructive/10 rounded-none">
								<WarningCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
								<div>
									<p className="text-sm text-destructive font-medium">Something went wrong</p>
									<p className="text-xs text-muted-foreground mt-1">{error}</p>
								</div>
							</div>
							<button
								type="button"
								onClick={checkAuth}
								className="w-full h-10 px-4 bg-primary text-primary-foreground rounded-none text-sm font-medium hover:brightness-110 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2"
							>
								<ArrowsClockwise className="w-4 h-4" />
								Try Again
							</button>
						</>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
