export interface TourStep {
  target: string | null; // data-tour attribute value, or null for centered card
  title: string;
  description: string;
  position?: 'left' | 'right' | 'bottom' | 'auto';
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: null,
    title: 'Welcome to Solo',
    description: 'Let me show you around your AI-native IDE.',
  },
  {
    target: 'explorer',
    title: 'File Explorer',
    description:
      'Browse and manage your project files. Right-click for actions like rename, delete, and new file.',
    position: 'right',
  },
  {
    target: 'sessions',
    title: 'AI Sessions',
    description:
      'Chat with the AI agent to get help coding, debugging, and refactoring -- right inside your editor.',
    position: 'right',
  },
  {
    target: 'source-control',
    title: 'Source Control',
    description:
      'View git changes, stage files, write commit messages, and push -- all without leaving Solo.',
    position: 'right',
  },
  {
    target: 'editor',
    title: 'Editor Panels',
    description:
      'Your files open as tabs here. Drag tabs to split the editor into side-by-side views.',
    position: 'auto',
  },
  {
    target: 'terminal-toggle',
    title: 'Integrated Terminal',
    description:
      'Toggle the terminal with \u2318J. Create multiple tabs and run commands without switching windows.',
    position: 'bottom',
  },
  {
    target: 'settings',
    title: 'Settings',
    description: 'Customize themes, AI models, keybindings, and more with \u2318,',
    position: 'bottom',
  },
  {
    target: null,
    title: "You're All Set!",
    description:
      'Have fun building. Click the tour button anytime to revisit this guide.',
  },
];
