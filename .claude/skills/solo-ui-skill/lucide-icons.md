# Lucide React Icons

Lucide is our icon library. It provides consistent, customizable SVG icons.

## Installation

```bash
bun add lucide-react
```

## Basic Usage

```tsx
import { Settings, Search, ChevronRight, X } from "lucide-react";

// Default size
<Settings className="w-4 h-4" />

// With color
<Settings className="w-4 h-4 text-muted-foreground" />

// With hover effect
<Settings className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors" />
```

---

## Standard Icon Sizes

```tsx
// Extra small - badges, inline
<Icon className="w-3 h-3" />       // 12px

// Small - compact UI
<Icon className="w-3.5 h-3.5" />   // 14px

// Default - buttons, lists
<Icon className="w-4 h-4" />       // 16px

// Medium - emphasis
<Icon className="w-5 h-5" />       // 20px

// Large - feature icons
<Icon className="w-6 h-6" />       // 24px

// Extra large - hero
<Icon className="w-8 h-8" />       // 32px
```

---

## Commonly Used Icons

### Navigation
```tsx
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
  ArrowRight,
  Menu,
  X,
  MoreHorizontal,
  MoreVertical,
} from "lucide-react";
```

### Actions
```tsx
import {
  Plus,
  Minus,
  Check,
  X,
  Edit,
  Trash2,
  Copy,
  Download,
  Upload,
  Share,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
```

### Files & Folders
```tsx
import {
  File,
  FileText,
  FileCode,
  Folder,
  FolderOpen,
  FolderPlus,
  Save,
  FilePlus,
} from "lucide-react";
```

### UI Elements
```tsx
import {
  Search,
  Settings,
  User,
  Bell,
  Home,
  Star,
  Heart,
  Bookmark,
  Eye,
  EyeOff,
  Lock,
  Unlock,
} from "lucide-react";
```

### Communication
```tsx
import {
  MessageSquare,
  MessageCircle,
  Send,
  Mail,
  Phone,
  Video,
} from "lucide-react";
```

### Development
```tsx
import {
  Terminal,
  Code,
  Bug,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Play,
  Pause,
  Square,
  SkipForward,
} from "lucide-react";
```

### Status & Feedback
```tsx
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  HelpCircle,
  Loader2,
  XCircle,
} from "lucide-react";
```

### Layout
```tsx
import {
  PanelLeft,
  PanelRight,
  PanelBottom,
  Columns,
  Rows,
  Grid,
  List,
  LayoutGrid,
  Maximize,
  Minimize,
  Expand,
  Shrink,
} from "lucide-react";
```

---

## Icon Button Pattern

```tsx
import { Settings } from "lucide-react";

// Standard icon button
<button className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground hover:scale-105 active:scale-95 transition-all duration-200">
  <Settings className="w-4 h-4" />
</button>

// Small icon button
<button className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-all duration-150">
  <Settings className="w-3.5 h-3.5" />
</button>

// Icon button with tooltip
<Tooltip>
  <TooltipTrigger asChild>
    <button className="w-8 h-8 ...">
      <Settings className="w-4 h-4" />
    </button>
  </TooltipTrigger>
  <TooltipContent>Settings</TooltipContent>
</Tooltip>
```

---

## Button with Icon

```tsx
import { Plus, ChevronRight, Loader2 } from "lucide-react";

// Icon before text
<button className="h-[34px] px-3.5 inline-flex items-center gap-2 ...">
  <Plus className="w-4 h-4" />
  Add Item
</button>

// Icon after text
<button className="h-[34px] px-3.5 inline-flex items-center gap-2 ...">
  Continue
  <ChevronRight className="w-4 h-4" />
</button>

// Loading state
<button className="h-[34px] px-3.5 inline-flex items-center gap-2 ..." disabled>
  <Loader2 className="w-4 h-4 animate-spin" />
  Loading...
</button>
```

---

## Sidebar Navigation

```tsx
import { Home, FolderOpen, MessageSquare, Settings } from "lucide-react";

const navItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: FolderOpen, label: "Files", path: "/files" },
  { icon: MessageSquare, label: "Chat", path: "/chat" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

// Collapsed sidebar (icon only)
<nav className="flex flex-col gap-1 p-2">
  {navItems.map(({ icon: Icon, label, path }) => (
    <Tooltip key={path}>
      <TooltipTrigger asChild>
        <button className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground">
          <Icon className="w-4 h-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  ))}
</nav>

// Expanded sidebar (icon + label)
<nav className="flex flex-col gap-1 p-2">
  {navItems.map(({ icon: Icon, label, path }) => (
    <button key={path} className="h-9 px-3 flex items-center gap-3 rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground">
      <Icon className="w-4 h-4 shrink-0" />
      <span className="text-sm truncate">{label}</span>
    </button>
  ))}
</nav>
```

---

## Status Icons

```tsx
import { CheckCircle, XCircle, AlertTriangle, Info, Loader2 } from "lucide-react";

// Success
<CheckCircle className="w-4 h-4 text-green-500" />

// Error
<XCircle className="w-4 h-4 text-destructive" />

// Warning
<AlertTriangle className="w-4 h-4 text-yellow-500" />

// Info
<Info className="w-4 h-4 text-blue-500" />

// Loading
<Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
```

---

## Best Practices

1. **Consistent sizing** - Use standard sizes (3, 3.5, 4, 5, 6)
2. **Match text color** - Icons should use same color as adjacent text
3. **Add shrink-0** - Prevent icons from shrinking in flex containers
4. **Use transitions** - Animate color changes on hover
5. **Accessible labels** - Add aria-label or sr-only text for icon-only buttons
6. **Loading states** - Use Loader2 with animate-spin

```tsx
// Accessible icon button
<button
  className="w-8 h-8 ..."
  aria-label="Open settings"
>
  <Settings className="w-4 h-4" />
</button>
```
