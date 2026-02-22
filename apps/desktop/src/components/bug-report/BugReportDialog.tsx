/**
 * BugReportDialog — modal for submitting bug reports to GitHub Issues.
 *
 * Supports screenshot pasting, AI-powered description expansion,
 * and direct submission to Solo-UDE/solo via GitHub Contents + Issues API.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  X,
  Bug,
  Image as ImageIcon,
  SpinnerGap,
  Warning,
  GithubLogo,
  CircleNotch,
  MagicWand,
  PaperPlaneTilt,
  ArrowsOutSimple,
  ArrowsInSimple,
} from '@phosphor-icons/react';
import { Button, IconButton, Input } from '@solo/ui';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import { useGitHubAccountsStore } from '@/stores/githubAccountsStore';
import {
  type BugScreenshot,
  BUG_EXPAND_SYSTEM_PROMPT,
  uploadScreenshots,
  buildIssueBody,
  submitBugReport,
} from '@/lib/bug-report';
import {
  agentCreateSession,
  agentSendMessage,
  agentDeleteSession,
} from '@/lib/backend';
import type { AgentMessageEvent } from '@/bindings';

interface BugReportDialogProps {
  onClose: () => void;
}

let screenshotCounter = 0;

export function BugReportDialog({ onClose }: BugReportDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshots, setScreenshots] = useState<BugScreenshot[]>([]);
  const [expandedDescription, setExpandedDescription] = useState<string | null>(null);
  const [isExpanding, setIsExpanding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExpanded, setShowExpanded] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const expandSessionRef = useRef<string | null>(null);

  const ghToken = useGitHubAccountsStore((s) => s.token);
  const connectGitHub = useGitHubAccountsStore((s) => s.connectGitHub);
  const isConnecting = useGitHubAccountsStore((s) => s.isConnecting);

  // Focus title input on mount
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting && !isExpanding) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, isSubmitting, isExpanding]);

  // Cleanup temp agent session on unmount
  useEffect(() => {
    return () => {
      if (expandSessionRef.current) {
        agentDeleteSession(expandSessionRef.current).catch(() => {});
      }
    };
  }, []);

  // Handle paste for screenshots
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          // Extract base64 without the data:image/png;base64, prefix
          const base64 = dataUrl.split(',')[1];
          const thumbnailUrl = dataUrl;
          const id = `screenshot-${++screenshotCounter}`;
          const name = `screenshot-${Date.now()}.png`;

          setScreenshots((prev) => [...prev, { id, base64, thumbnailUrl, name }]);
        };
        reader.readAsDataURL(blob);
      }
    }
  }, []);

  // Handle drag & drop for screenshots
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(',')[1];
          const thumbnailUrl = dataUrl;
          const id = `screenshot-${++screenshotCounter}`;

          setScreenshots((prev) => [...prev, { id, base64, thumbnailUrl, name: file.name }]);
        };
        reader.readAsDataURL(file);
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeScreenshot = useCallback((id: string) => {
    setScreenshots((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // AI-powered description expansion
  const handleExpand = useCallback(async () => {
    if (!description.trim() || isExpanding) return;

    setIsExpanding(true);
    setError(null);

    const sessionId = `bug-expand-${Date.now()}`;
    expandSessionRef.current = sessionId;
    let collected = '';

    try {
      // Create a lightweight agent session
      await agentCreateSession(sessionId, { model: 'haiku' });

      // Listen for agent messages from this session
      const unlisten: UnlistenFn = await listen<AgentMessageEvent>(
        'agent:message',
        (event) => {
          if (event.payload.sessionId !== sessionId) return;

          const msg = event.payload.message;
          if (msg.type === 'text') {
            collected += msg.content;
          }
          if (msg.type === 'result') {
            // Response complete — use collected text or the result content
            const final = collected.trim() || msg.content;
            setExpandedDescription(final);
            setShowExpanded(true);
            setIsExpanding(false);

            // Cleanup
            unlisten();
            agentDeleteSession(sessionId).catch(() => {});
            expandSessionRef.current = null;
          }
          if (msg.type === 'error') {
            setError(`AI expansion failed: ${msg.content}`);
            setIsExpanding(false);
            unlisten();
            agentDeleteSession(sessionId).catch(() => {});
            expandSessionRef.current = null;
          }
        },
      );

      // Send the expansion prompt
      const prompt = `${BUG_EXPAND_SYSTEM_PROMPT}\n\n---\n\nUser's bug description:\n${description}`;
      await agentSendMessage(sessionId, prompt);
    } catch (err) {
      setError(`Failed to expand description: ${err instanceof Error ? err.message : String(err)}`);
      setIsExpanding(false);
      expandSessionRef.current = null;
    }
  }, [description, isExpanding]);

  // Submit bug report to GitHub
  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !description.trim() || !ghToken || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Upload screenshots first
      let screenshotUrls: string[] = [];
      if (screenshots.length > 0) {
        screenshotUrls = await uploadScreenshots(ghToken, screenshots);
      }

      // Build the issue body
      const body = buildIssueBody(description, expandedDescription, screenshotUrls);

      // Create the issue
      const result = await submitBugReport(ghToken, title, body);

      toast.success('Bug report submitted', {
        description: `Issue #${result.number} created`,
        action: {
          label: 'View',
          onClick: () => window.open(result.html_url, '_blank'),
        },
      });

      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Friendly message for users without repo access
      if (msg.includes('404') || msg.includes('Not Found')) {
        setError('You don\'t have access to the bug report repository. This feature is available to team members only.');
      } else if (msg.includes('403') || msg.includes('Forbidden')) {
        setError('Permission denied. Your GitHub account may not have write access to the bug report repository.');
      } else {
        setError(msg);
      }
      setIsSubmitting(false);
    }
  }, [title, description, ghToken, screenshots, expandedDescription, isSubmitting, onClose]);

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !!ghToken && !isSubmitting;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onPaste={handlePaste}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={isSubmitting ? undefined : onClose}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="relative w-full max-w-lg bg-card/95 backdrop-blur-md rounded-[14px] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] border border-border/30 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-primary" weight="duotone" />
            <h2 className="text-sm font-semibold text-foreground">Report a Bug</h2>
          </div>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
            title="Close"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </IconButton>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* No GitHub token state */}
          {!ghToken && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-muted/40 text-muted-foreground text-xs">
                <GithubLogo className="w-3.5 h-3.5 shrink-0 mt-0.5" weight="bold" />
                <span>Connect your GitHub account to submit bug reports.</span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => connectGitHub()}
                disabled={isConnecting}
                className="w-full h-8 text-xs"
              >
                {isConnecting ? (
                  <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <GithubLogo className="w-3.5 h-3.5" weight="bold" />
                )}
                {isConnecting ? 'Waiting for authorization...' : 'Connect GitHub'}
              </Button>
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Title</label>
            <Input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief summary of the bug"
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happened..."
              disabled={isSubmitting}
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg bg-muted/40 border-none resize-none focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none transition-colors placeholder:text-muted-foreground/50 text-foreground"
              style={{ minHeight: '72px', maxHeight: '192px' }}
            />
          </div>

          {/* Screenshots */}
          {screenshots.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Screenshots</label>
              <div className="flex gap-2 flex-wrap">
                {screenshots.map((ss) => (
                  <div
                    key={ss.id}
                    className="relative group w-16 h-16 rounded-md overflow-hidden border border-border/50 bg-muted"
                  >
                    <img
                      src={ss.thumbnailUrl}
                      alt={ss.name}
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => removeScreenshot(ss.id)}
                      className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 bg-black/60 rounded-full p-0.5 transition-opacity"
                      type="button"
                    >
                      <X className="w-3 h-3 text-white" weight="bold" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Paste hint */}
          {screenshots.length === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/20 border border-dashed border-border/40">
              <ImageIcon className="w-3.5 h-3.5 text-muted-foreground/50" />
              <span className="text-xs text-muted-foreground/50">
                Paste ({navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+V) or drag screenshots here
              </span>
            </div>
          )}

          {/* Expanded preview */}
          {expandedDescription && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground">AI-Expanded Description</label>
                <button
                  onClick={() => setShowExpanded((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showExpanded ? (
                    <ArrowsInSimple className="w-3 h-3" />
                  ) : (
                    <ArrowsOutSimple className="w-3 h-3" />
                  )}
                  {showExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
              {showExpanded && (
                <div className="px-3 py-2 rounded-lg bg-muted/30 text-xs text-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {expandedDescription}
                </div>
              )}
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-xs">
              <Warning className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExpand}
              disabled={!description.trim() || isExpanding || isSubmitting}
              className="h-8 px-3 text-xs"
              title={!description.trim() ? 'Enter a description first' : 'Expand description with AI'}
            >
              {isExpanding ? (
                <SpinnerGap className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <MagicWand className="w-3.5 h-3.5" />
              )}
              {isExpanding ? 'Expanding...' : 'Expand with AI'}
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="h-8 px-4 text-xs"
            >
              {isSubmitting ? (
                <>
                  <SpinnerGap className="w-3.5 h-3.5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <PaperPlaneTilt className="w-3.5 h-3.5" />
                  Submit to GitHub
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
