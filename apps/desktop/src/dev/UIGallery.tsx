/**
 * UIGallery — visual reference surface for every @solo/ui primitive.
 *
 * To mount: add the following to apps/desktop/src/main.tsx temporarily, or
 * swap App.tsx's root export to UIGallery for in-app testing:
 *
 *   if (new URLSearchParams(location.search).has("__gallery")) {
 *     import("./dev/UIGallery").then(({ UIGallery }) =>
 *       ReactDOM.createRoot(document.getElementById("root")!).render(<UIGallery />)
 *     );
 *   } else {
 *     // ... normal render
 *   }
 *
 * Then launch with any URL appended `?__gallery=1`. For Tauri dev mode, the
 * simplest route is to replace the `<App />` render in main.tsx with
 * `<UIGallery />` while iterating on primitives — revert before committing.
 *
 * Every primitive appears in every variant/size. Hover, focus, and disabled
 * states are reachable. Use this to eyeball changes to tokens or primitives.
 */

import { useState } from "react";
import {
  Avatar, AvatarFallback, AvatarImage,
  Badge,
  Button,
  Checkbox,
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
  IconButton,
  Input,
  Kbd,
  Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger,
  Panel,
  Popover, PopoverContent, PopoverTrigger,
  RadioGroup, RadioItem,
  ScrollArea,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Separator,
  Skeleton,
  Spinner,
  Switch,
  Tabs, TabsContent, TabsList, TabsTrigger,
  Textarea,
  Toaster, toast,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@solo/ui";
import { Plus, Settings } from "lucide-react";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="rounded-lg bg-card p-4 ring-1 ring-black/5 dark:ring-white/5 shadow-md space-y-3">
        {children}
      </div>
    </section>
  );
}

function Row({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && <span className="min-w-20 text-[11px] text-muted-foreground uppercase tracking-wide">{label}</span>}
      {children}
    </div>
  );
}

export function UIGallery() {
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  const toggleDark = () => {
    document.documentElement.classList.toggle("dark");
    setDark(document.documentElement.classList.contains("dark"));
  };

  return (
    <TooltipProvider delayDuration={100}>
      <div className="min-h-dvh bg-background text-foreground antialiased">
        <Toaster />

        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-tight">@solo/ui gallery</h1>
            <p className="text-[11px] text-muted-foreground">Every primitive, every variant, every state</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={toggleDark}>{dark ? "Light" : "Dark"}</Button>
          </div>
        </header>

        <main className="mx-auto max-w-5xl space-y-8 p-8">
          {/* ── Button ───────────────────────────────────────────────── */}
          <Section title="Button">
            <Row label="variants">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </Row>
            <Row label="sizes">
              {(["xs", "sm", "md", "lg"] as const).map((s) => (
                <Button key={s} size={s}>{s}</Button>
              ))}
            </Row>
            <Row label="states">
              <Button loading>Loading</Button>
              <Button disabled>Disabled</Button>
              <Button leadingIcon={<Plus />}>Leading icon</Button>
              <Button trailingIcon={<Plus />}>Trailing icon</Button>
            </Row>
          </Section>

          {/* ── IconButton ───────────────────────────────────────────── */}
          <Section title="IconButton">
            <Row label="variants">
              {(["ghost", "muted", "outline", "solid"] as const).map((v) => (
                <IconButton key={v} variant={v} label={v}><Settings /></IconButton>
              ))}
            </Row>
            <Row label="sizes">
              {(["xs", "sm", "md", "lg"] as const).map((s) => (
                <IconButton key={s} size={s} label={s}><Settings /></IconButton>
              ))}
            </Row>
          </Section>

          {/* ── Input & Textarea ─────────────────────────────────────── */}
          <Section title="Input & Textarea">
            <Row label="input">
              <div className="w-64"><Input size="sm" placeholder="sm" /></div>
              <div className="w-64"><Input size="md" placeholder="md (default)" /></div>
              <div className="w-64"><Input variant="error" placeholder="error" /></div>
              <div className="w-64"><Input disabled placeholder="disabled" /></div>
            </Row>
            <Row label="textarea">
              <div className="w-80"><Textarea placeholder="Multi-line text…" /></div>
            </Row>
          </Section>

          {/* ── Badge & Kbd ──────────────────────────────────────────── */}
          <Section title="Badge & Kbd">
            <Row label="badges">
              {(["default", "secondary", "outline", "success", "warning", "destructive", "info"] as const).map((v) => (
                <Badge key={v} variant={v}>{v}</Badge>
              ))}
            </Row>
            <Row label="kbd">
              <Kbd>⌘</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>K</Kbd>
              <Kbd size="md">Enter</Kbd>
            </Row>
          </Section>

          {/* ── Checkbox, Switch, Radio ──────────────────────────────── */}
          <Section title="Form controls">
            <Row label="checkbox">
              <Checkbox id="cb1" defaultChecked />
              <label htmlFor="cb1" className="text-[13px]">Checked</label>
              <Checkbox id="cb2" />
              <label htmlFor="cb2" className="text-[13px]">Unchecked</label>
              <Checkbox disabled />
            </Row>
            <Row label="switch">
              <Switch id="sw1" defaultChecked />
              <Switch id="sw2" />
              <Switch disabled />
              <Switch size="sm" defaultChecked />
            </Row>
            <Row label="radio">
              <RadioGroup defaultValue="a" className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioItem value="a" id="r-a" />
                  <label htmlFor="r-a" className="text-[13px]">Option A</label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioItem value="b" id="r-b" />
                  <label htmlFor="r-b" className="text-[13px]">Option B</label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioItem value="c" id="r-c" disabled />
                  <label htmlFor="r-c" className="text-[13px] text-muted-foreground">Disabled</label>
                </div>
              </RadioGroup>
            </Row>
          </Section>

          {/* ── Select ───────────────────────────────────────────────── */}
          <Section title="Select">
            <Row label="default">
              <div className="w-56">
                <Select>
                  <SelectTrigger><SelectValue placeholder="Pick a fruit…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apple">Apple</SelectItem>
                    <SelectItem value="banana">Banana</SelectItem>
                    <SelectItem value="cherry">Cherry</SelectItem>
                    <SelectItem value="durian" disabled>Durian (disabled)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </Row>
          </Section>

          {/* ── Tabs ─────────────────────────────────────────────────── */}
          <Section title="Tabs">
            <Row label="default">
              <div className="w-full">
                <Tabs defaultValue="overview">
                  <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="activity">Activity</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview" className="pt-3 text-[13px] text-muted-foreground">Overview tab content.</TabsContent>
                  <TabsContent value="activity" className="pt-3 text-[13px] text-muted-foreground">Activity tab content.</TabsContent>
                  <TabsContent value="settings" className="pt-3 text-[13px] text-muted-foreground">Settings tab content.</TabsContent>
                </Tabs>
              </div>
            </Row>
            <Row label="pills">
              <div className="w-full">
                <Tabs defaultValue="a">
                  <TabsList variant="pills">
                    <TabsTrigger variant="pills" value="a">One</TabsTrigger>
                    <TabsTrigger variant="pills" value="b">Two</TabsTrigger>
                    <TabsTrigger variant="pills" value="c">Three</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </Row>
          </Section>

          {/* ── Dialog, Popover, Menu, ContextMenu, Tooltip ──────────── */}
          <Section title="Overlays">
            <Row label="dialog">
              <Dialog>
                <DialogTrigger asChild><Button>Open dialog</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Dialog title</DialogTitle>
                    <DialogDescription>
                      Dialog description text. Uses Codex's dialog-enter keyframe
                      and the flatter shadow scale from extraction.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                    <DialogClose asChild><Button>Confirm</Button></DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </Row>
            <Row label="popover">
              <Popover>
                <PopoverTrigger asChild><Button variant="outline">Popover</Button></PopoverTrigger>
                <PopoverContent withArrow>
                  <div className="space-y-1">
                    <h3 className="text-[13px] font-semibold">Settings</h3>
                    <p className="text-[12px] text-muted-foreground">
                      Inline popover content aligned to trigger.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            </Row>
            <Row label="menu">
              <Menu>
                <MenuTrigger asChild><Button variant="outline">Dropdown</Button></MenuTrigger>
                <MenuContent>
                  <MenuItem>New file <Kbd className="ml-auto">⌘N</Kbd></MenuItem>
                  <MenuItem>Open recent</MenuItem>
                  <MenuSeparator />
                  <MenuItem>Save</MenuItem>
                  <MenuItem>Save as…</MenuItem>
                </MenuContent>
              </Menu>
            </Row>
            <Row label="context">
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div className="rounded-md border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground">
                    Right-click me
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem>Copy</ContextMenuItem>
                  <ContextMenuItem>Paste</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem>Delete</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </Row>
            <Row label="tooltip">
              <Tooltip>
                <TooltipTrigger asChild><Button variant="ghost">Hover me</Button></TooltipTrigger>
                <TooltipContent>Tooltip text</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton variant="ghost" label="Settings"><Settings /></IconButton>
                </TooltipTrigger>
                <TooltipContent>Open settings <Kbd className="ml-1.5">⌘,</Kbd></TooltipContent>
              </Tooltip>
            </Row>
            <Row label="toast">
              <Button variant="outline" onClick={() => toast("Hello from Sonner")}>Toast</Button>
              <Button variant="outline" onClick={() => toast.success("Saved successfully")}>Success</Button>
              <Button variant="outline" onClick={() => toast.error("Something broke")}>Error</Button>
            </Row>
          </Section>

          {/* ── Surfaces ─────────────────────────────────────────────── */}
          <Section title="Surfaces">
            <Row label="panel">
              <div className="flex gap-4 w-full">
                <Panel className="p-4 flex-1"><p className="text-[13px]">default</p></Panel>
                <Panel variant="inset" className="p-4 flex-1"><p className="text-[13px]">inset</p></Panel>
                <Panel variant="raised" className="p-4 flex-1"><p className="text-[13px]">raised</p></Panel>
              </div>
            </Row>
            <Row label="separator">
              <div className="flex items-center gap-2 text-[13px]">
                <span>Left</span>
                <Separator orientation="vertical" className="h-4" />
                <span>Middle</span>
                <Separator orientation="vertical" className="h-4" />
                <span>Right</span>
              </div>
            </Row>
          </Section>

          {/* ── Avatar & Skeleton & Spinner ──────────────────────────── */}
          <Section title="Avatar, Skeleton, Spinner">
            <Row label="avatar">
              {(["xs", "sm", "md", "lg"] as const).map((s) => (
                <Avatar key={s} size={s}>
                  <AvatarImage src={`https://avatars.githubusercontent.com/u/1?size=${s === "lg" ? 80 : 40}`} />
                  <AvatarFallback>SA</AvatarFallback>
                </Avatar>
              ))}
            </Row>
            <Row label="skeleton">
              <Skeleton className="h-4 w-24" />
              <Skeleton variant="shimmer" className="h-4 w-32" />
              <Skeleton className="size-10 rounded-full" />
            </Row>
            <Row label="spinner">
              {(["xs", "sm", "md", "lg"] as const).map((s) => (
                <Spinner key={s} size={s} />
              ))}
            </Row>
          </Section>

          {/* ── ScrollArea ───────────────────────────────────────────── */}
          <Section title="ScrollArea">
            <div className="rounded-md border border-border">
              <ScrollArea className="h-40 w-full p-3">
                <div className="space-y-2">
                  {Array.from({ length: 20 }).map((_, i) => (
                    <div key={i} className="text-[13px] text-muted-foreground">Scrollable item #{i + 1}</div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </Section>
        </main>

        <footer className="border-t border-border/60 px-6 py-4 text-[11px] text-muted-foreground">
          Tokens last built from <code>packages/ui/src/tokens/</code>. See <code>.solo/skills/design/</code> for the design system.
        </footer>
      </div>
    </TooltipProvider>
  );
}
