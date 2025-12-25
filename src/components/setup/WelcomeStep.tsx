"use client";

/**
 * Welcome Step
 *
 * First step of the setup wizard introducing Remote Dev features.
 */

import { useSetupWizard } from "./SetupWizardContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Terminal,
  GitBranch,
  Layout,
  Globe,
  Clock,
  Shield,
} from "lucide-react";

const FEATURES = [
  {
    icon: Terminal,
    title: "Persistent Terminal Sessions",
    description: "Sessions survive disconnections via tmux integration",
  },
  {
    icon: GitBranch,
    title: "Git Worktree Support",
    description: "Isolate branches in separate working directories",
  },
  {
    icon: Layout,
    title: "Split Pane Layouts",
    description: "Run multiple terminals side-by-side",
  },
  {
    icon: Globe,
    title: "Secure Remote Access",
    description: "Access from anywhere via Cloudflare Tunnel",
  },
  {
    icon: Clock,
    title: "Session Recording",
    description: "Record and replay terminal sessions",
  },
  {
    icon: Shield,
    title: "GitHub Integration",
    description: "Browse repos and create worktrees from issues",
  },
];

export function WelcomeStep() {
  const { nextStep, skipSetup } = useSetupWizard();

  return (
    <div className="flex flex-col items-center justify-center min-h-[500px] p-8">
      <div className="text-center mb-8">
        <div className="flex items-center justify-center mb-4">
          <Terminal className="h-16 w-16 text-primary" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Welcome to Remote Dev</h1>
        <p className="text-muted-foreground text-lg max-w-md">
          A powerful terminal workspace with persistent sessions,
          Git integration, and secure remote access.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mb-8">
        {FEATURES.map((feature) => (
          <Card key={feature.title} className="bg-card/50 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <feature.icon className="h-5 w-5 text-primary" />
                {feature.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col items-center gap-4">
        <Button size="lg" onClick={nextStep} className="min-w-[200px]">
          Get Started
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={skipSetup}
          className="text-muted-foreground"
        >
          Skip setup and use defaults
        </Button>
        <p className="text-xs text-muted-foreground">
          Setup takes about 2-3 minutes
        </p>
      </div>
    </div>
  );
}
