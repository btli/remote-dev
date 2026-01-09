"use client";

/**
 * ProjectKnowledgePanel - Display and edit project knowledge.
 *
 * Shows:
 * - Tech stack
 * - Conventions
 * - Learned patterns
 * - Skills and tools
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useState as useStateCollapsible } from "react";
import {
  Code2,
  FileCode2,
  Lightbulb,
  Wrench,
  BookOpen,
  RefreshCw,
  Plus,
  Loader2,
} from "lucide-react";
import {
  useProjectKnowledge,
  type Convention,
  type LearnedPattern,
  type SkillDefinition,
  type ToolDefinition,
} from "@/hooks/useProjectKnowledge";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectKnowledgePanelProps {
  folderId: string;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ProjectKnowledgePanel({
  folderId,
  className,
}: ProjectKnowledgePanelProps) {
  const { knowledge, loading, error, exists, fetch, scan } = useProjectKnowledge({
    folderId,
  });

  const [scanning, setScanning] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    try {
      await scan();
      await fetch();
    } finally {
      setScanning(false);
    }
  };

  if (loading && !knowledge) {
    return (
      <div className={cn("flex items-center justify-center p-8", className)}>
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("p-4 text-center", className)}>
        <p className="text-red-500 mb-2">{error}</p>
        <Button variant="outline" onClick={fetch}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (!exists || !knowledge) {
    return (
      <div className={cn("p-4 text-center", className)}>
        <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground mb-4">
          No project knowledge yet
        </p>
        <Button onClick={handleScan} disabled={scanning}>
          {scanning ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Scan Project
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h3 className="font-semibold">Project Knowledge</h3>
          {knowledge.metadata.projectName && (
            <p className="text-sm text-muted-foreground">
              {knowledge.metadata.projectName}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning}>
          {scanning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Tech Stack */}
      {knowledge.techStack.length > 0 && (
        <div className="px-4 py-3 border-b">
          <p className="text-xs text-muted-foreground mb-2">Tech Stack</p>
          <div className="flex flex-wrap gap-1">
            {knowledge.techStack.map((tech) => (
              <Badge key={tech} variant="secondary" className="text-xs">
                {tech}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="conventions" className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start rounded-none border-b px-4">
          <TabsTrigger value="conventions" className="gap-1">
            <FileCode2 className="h-3 w-3" />
            Conventions
            <Badge variant="outline" className="ml-1 h-5 px-1.5">
              {knowledge.conventions.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="patterns" className="gap-1">
            <Lightbulb className="h-3 w-3" />
            Patterns
            <Badge variant="outline" className="ml-1 h-5 px-1.5">
              {knowledge.patterns.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="skills" className="gap-1">
            <Code2 className="h-3 w-3" />
            Skills
            <Badge variant="outline" className="ml-1 h-5 px-1.5">
              {knowledge.skills.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="tools" className="gap-1">
            <Wrench className="h-3 w-3" />
            Tools
            <Badge variant="outline" className="ml-1 h-5 px-1.5">
              {knowledge.tools.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1">
          <TabsContent value="conventions" className="m-0 p-4">
            <ConventionsList conventions={knowledge.conventions} />
          </TabsContent>
          <TabsContent value="patterns" className="m-0 p-4">
            <PatternsList patterns={knowledge.patterns} />
          </TabsContent>
          <TabsContent value="skills" className="m-0 p-4">
            <SkillsList skills={knowledge.skills} />
          </TabsContent>
          <TabsContent value="tools" className="m-0 p-4">
            <ToolsList tools={knowledge.tools} />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ConventionsList({ conventions }: { conventions: Convention[] }) {
  const [expandedCategories, setExpandedCategories] = useStateCollapsible<Set<string>>(
    new Set()
  );

  if (conventions.length === 0) {
    return (
      <EmptyState
        icon={FileCode2}
        message="No conventions learned yet"
        action="Add Convention"
      />
    );
  }

  const grouped = groupBy(conventions, "category");

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {Object.entries(grouped).map(([category, items]) => {
        const isExpanded = expandedCategories.has(category);
        return (
          <div key={category} className="border rounded-lg">
            <button
              onClick={() => toggleCategory(category)}
              className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {category.replace("_", " ")}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {items.length} convention{items.length !== 1 ? "s" : ""}
                </span>
              </div>
              <span className="text-muted-foreground">{isExpanded ? "−" : "+"}</span>
            </button>
            {isExpanded && (
              <div className="px-3 pb-3 space-y-2">
                {items.map((convention) => (
                  <Card key={convention.id} className="border-muted">
                    <CardContent className="p-3">
                      <p className="text-sm">{convention.description}</p>
                      {convention.examples.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground">Examples:</p>
                          <ul className="text-xs text-muted-foreground list-disc list-inside">
                            {convention.examples.slice(0, 2).map((ex, i) => (
                              <li key={i}>{ex}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="secondary" className="text-xs">
                          {Math.round(convention.confidence * 100)}% confidence
                        </Badge>
                        <Badge variant="outline" className="text-xs capitalize">
                          {convention.source}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PatternsList({ patterns }: { patterns: LearnedPattern[] }) {
  if (patterns.length === 0) {
    return (
      <EmptyState
        icon={Lightbulb}
        message="No patterns learned yet"
        action="Add Pattern"
      />
    );
  }

  return (
    <div className="space-y-2">
      {patterns.map((pattern) => (
        <Card key={pattern.id} className="border-muted">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Badge
                variant={pattern.type === "success" ? "default" : "destructive"}
                className="text-xs capitalize"
              >
                {pattern.type.replace("_", " ")}
              </Badge>
            </div>
            <p className="text-sm">{pattern.description}</p>
            {pattern.context && (
              <p className="text-xs text-muted-foreground mt-1">
                Context: {pattern.context}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SkillsList({ skills }: { skills: SkillDefinition[] }) {
  if (skills.length === 0) {
    return (
      <EmptyState
        icon={Code2}
        message="No skills defined yet"
        action="Add Skill"
      />
    );
  }

  return (
    <div className="space-y-2">
      {skills.map((skill) => (
        <Card key={skill.id} className="border-muted">
          <CardHeader className="p-3 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{skill.name}</CardTitle>
              <Badge variant={skill.verified ? "default" : "secondary"} className="text-xs">
                {skill.verified ? "Verified" : "Unverified"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              {skill.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <code className="text-xs bg-muted px-2 py-1 rounded">
              {skill.command}
            </code>
            {skill.triggers.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {skill.triggers.map((trigger, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {trigger}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ToolsList({ tools }: { tools: ToolDefinition[] }) {
  if (tools.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        message="No tools defined yet"
        action="Add Tool"
      />
    );
  }

  return (
    <div className="space-y-2">
      {tools.map((tool) => (
        <Card key={tool.id} className="border-muted">
          <CardHeader className="p-3 pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{tool.name}</CardTitle>
              <Badge variant="secondary" className="text-xs capitalize">
                {tool.implementation.type}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              {tool.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            {tool.triggers.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tool.triggers.map((trigger, i) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {trigger}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
  action,
}: {
  icon: React.ElementType;
  message: string;
  action: string;
}) {
  return (
    <div className="text-center py-8">
      <Icon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
      <p className="text-sm text-muted-foreground mb-3">{message}</p>
      <Button variant="outline" size="sm">
        <Plus className="h-3 w-3 mr-1" />
        {action}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce(
    (groups, item) => {
      const value = String(item[key]);
      if (!groups[value]) {
        groups[value] = [];
      }
      groups[value].push(item);
      return groups;
    },
    {} as Record<string, T[]>
  );
}
