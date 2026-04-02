"use client";

import { useState, useEffect, lazy, Suspense } from "react";
import {
  Terminal,
  Palette,
  Folder,
  Sparkles,
  Network,
  Fingerprint,
  KeyRound,
  Circle,
  Server,
  ScrollText,
  Smartphone,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// Lazy-load sections so the main bundle stays small
const TerminalSection = lazy(() =>
  import("./sections/TerminalSection").then((m) => ({ default: m.TerminalSection }))
);
const AppearanceSection = lazy(() =>
  import("./sections/AppearanceSection").then((m) => ({ default: m.AppearanceSection }))
);
const ProjectSection = lazy(() =>
  import("./sections/ProjectSection").then((m) => ({ default: m.ProjectSection }))
);
const AgentsSection = lazy(() =>
  import("./sections/AgentsSection").then((m) => ({ default: m.AgentsSection }))
);
const ProxySection = lazy(() =>
  import("./sections/ProxySection").then((m) => ({ default: m.ProxySection }))
);
const ProfilesSection = lazy(() =>
  import("./sections/ProfilesSection").then((m) => ({ default: m.ProfilesSection }))
);
const SecretsSection = lazy(() =>
  import("./sections/SecretsSection").then((m) => ({ default: m.SecretsSection }))
);
const SystemSection = lazy(() =>
  import("./sections/SystemSection").then((m) => ({ default: m.SystemSection }))
);
const LogsSection = lazy(() =>
  import("./sections/LogsSection").then((m) => ({ default: m.LogsSection }))
);
const MobileSection = lazy(() =>
  import("./sections/MobileSection").then((m) => ({ default: m.MobileSection }))
);
const BeadsSection = lazy(() =>
  import("./sections/BeadsSection").then((m) => ({ default: m.BeadsSection }))
);

export type SettingsSection =
  | "terminal"
  | "appearance"
  | "project"
  | "agents"
  | "proxy"
  | "profiles"
  | "secrets"
  | "beads"
  | "system"
  | "logs"
  | "mobile";

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: (NavItem | "divider")[] = [
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "project", label: "Project", icon: Folder },
  { id: "agents", label: "Agents", icon: Sparkles },
  { id: "proxy", label: "Proxy", icon: Network },
  "divider",
  { id: "profiles", label: "Profiles", icon: Fingerprint },
  { id: "secrets", label: "Secrets", icon: KeyRound },
  { id: "beads", label: "Beads", icon: Circle },
  "divider",
  { id: "system", label: "System", icon: Server },
  { id: "logs", label: "Logs", icon: ScrollText },
  { id: "mobile", label: "Mobile", icon: Smartphone },
];

interface SettingsViewProps {
  onClose: () => void;
  initialSection?: SettingsSection;
}

function SectionLoader() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}

export function SettingsView({ onClose, initialSection }: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(
    initialSection ?? "terminal"
  );

  // Escape key closes settings — cleanup is automatic on unmount
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function renderSection() {
    switch (activeSection) {
      case "terminal":
        return <TerminalSection />;
      case "appearance":
        return <AppearanceSection />;
      case "project":
        return <ProjectSection />;
      case "agents":
        return <AgentsSection />;
      case "proxy":
        return <ProxySection />;
      case "profiles":
        return <ProfilesSection />;
      case "secrets":
        return <SecretsSection />;
      case "system":
        return <SystemSection />;
      case "logs":
        return <LogsSection />;
      case "beads":
        return <BeadsSection />;
      case "mobile":
        return <MobileSection />;
    }
  }

  // Find the active nav item for the title
  const activeItem = NAV_ITEMS.find(
    (item): item is NavItem => item !== "divider" && item.id === activeSection
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h2 className="text-lg font-semibold text-foreground">Settings</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Body: nav + content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left navigation */}
        <nav className="w-48 shrink-0 border-r border-border py-3 px-2 overflow-y-auto">
          {NAV_ITEMS.map((item, idx) => {
            if (item === "divider") {
              return (
                <div
                  key={`divider-${idx}`}
                  className="my-2 mx-2 border-t border-border"
                />
              );
            }

            const Icon = item.icon;
            const isActive = activeSection === item.id;

            return (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-primary/15 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right content area */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {/* Section header */}
          <div className="px-8 pt-6 pb-4 shrink-0">
            <h3 className="text-base font-medium text-foreground">
              {activeItem?.label}
            </h3>
          </div>

          {/* Section content */}
          {activeSection === "logs" || activeSection === "profiles" || activeSection === "secrets" ? (
            // These sections manage their own scrolling and need flex layout for proper height
            <div className="flex-1 min-h-0 px-8 pb-6 overflow-hidden flex flex-col">
              <Suspense fallback={<SectionLoader />}>
                {renderSection()}
              </Suspense>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="px-8 pb-8 max-w-2xl">
                <Suspense fallback={<SectionLoader />}>
                  {renderSection()}
                </Suspense>
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
    </div>
  );
}
