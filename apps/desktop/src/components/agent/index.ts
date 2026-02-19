// Main components
export { AgentWindow, type AgentWindowProps, type AgentWindowCallbacks, type AgentWindowUIOptions } from './AgentWindow';
export { AgentWindowHeader, type AgentWindowHeaderProps } from './AgentWindowHeader';
export { SoloEmptyState } from './SoloDecryptAnimation';
export { SessionList, type SessionListProps } from './SessionList';

// Message components
export { MessageFeed, type MessageFeedProps, type MessageGroup } from './messages';
export { UserMessage, type UserMessageProps } from './messages';
export { AgentMessage, type AgentMessageProps, type AgentMessageContent } from './messages';
export { AgentNarrative, type AgentNarrativeProps } from './messages';
export { MessageSection, type MessageSectionProps, type Message, type UserMessageData, type AgentMessageData } from './messages';
export { TaskPhaseCard, type TaskPhaseCardProps, type FileEdit, type ProgressUpdate } from './messages';
export { ProgressUpdates, type ProgressUpdatesProps } from './messages';
export { ProgressStep, type ProgressStepProps } from './messages';
export { ToolCallBlock, type ToolCallBlockProps } from './messages';
export { NotifyUserCard, type NotifyUserCardProps, type NotificationAction } from './messages';
export { ProceedIndicator, type ProceedIndicatorProps } from './messages';
export { MessageFeedback, type MessageFeedbackProps } from './messages';
export { FilesEditedList, type FilesEditedListProps, type FileEditInfo } from './messages';

// Input components
export { ChatInputContainer, type ChatInputContainerProps } from './input';
export { LexicalEditor, type LexicalEditorProps } from './input';
export { ModeSelector, type ModeSelectorProps, type Mode } from './input';
export { ModelSelector, type ModelSelectorProps, type ModelOption, CLAUDE_MODELS } from './input';
export { ModelPicker, type ModelPickerProps, renderModelIcon } from './input';
export { ContextMenu, type ContextMenuProps } from './input';
export { SubmitButton, type SubmitButtonProps } from './input';

// Code components
export { CodeBlock, type CodeBlockProps } from './code';
export { InlineCode, type InlineCodeProps } from './code';
export { CopyButton, type CopyButtonProps } from './code';

// Dialogs
export { ApiKeyDialog, type ApiKeyDialogProps } from './dialogs';
export { ToolApprovalDialog, type ToolApprovalDialogProps } from './dialogs';
