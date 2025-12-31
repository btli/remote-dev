"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check, Sparkles } from "lucide-react";
import { PROFILE_TEMPLATES, type ProfileTemplate } from "@/data/profile-templates";

interface ProfileTemplateSelectorProps {
  selectedTemplateId?: string | null;
  onSelect: (template: ProfileTemplate | null) => void;
  disabled?: boolean;
}

/**
 * ProfileTemplateSelector - Grid of profile templates to choose from
 *
 * Used when creating a new profile to start with pre-configured settings.
 * Selecting "Blank" (null) creates an empty profile.
 */
export function ProfileTemplateSelector({
  selectedTemplateId,
  onSelect,
  disabled = false,
}: ProfileTemplateSelectorProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Sparkles className="w-4 h-4" />
        <span>Choose a template or start blank</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Blank Template Option */}
        <button
          onClick={() => onSelect(null)}
          onMouseEnter={() => setHoveredId("blank")}
          onMouseLeave={() => setHoveredId(null)}
          disabled={disabled}
          className={cn(
            "relative flex flex-col items-start p-4 rounded-lg border-2 transition-all text-left",
            "hover:border-primary/50 hover:bg-muted/50",
            selectedTemplateId === null
              ? "border-primary bg-primary/5"
              : "border-border bg-background",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          {/* Selection indicator */}
          {selectedTemplateId === null && (
            <div className="absolute top-3 right-3">
              <Check className="w-4 h-4 text-primary" />
            </div>
          )}

          {/* Icon */}
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xl mb-3">
            📄
          </div>

          {/* Content */}
          <div className="space-y-1">
            <h4 className="font-medium text-foreground">Blank</h4>
            <p className="text-xs text-muted-foreground line-clamp-2">
              Start with default settings and configure from scratch
            </p>
          </div>
        </button>

        {/* Template Options */}
        {PROFILE_TEMPLATES.map((template) => {
          const isSelected = selectedTemplateId === template.id;
          const isHovered = hoveredId === template.id;

          return (
            <button
              key={template.id}
              onClick={() => onSelect(template)}
              onMouseEnter={() => setHoveredId(template.id)}
              onMouseLeave={() => setHoveredId(null)}
              disabled={disabled}
              className={cn(
                "relative flex flex-col items-start p-4 rounded-lg border-2 transition-all text-left",
                "hover:border-primary/50 hover:bg-muted/50",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border bg-background",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {/* Selection indicator */}
              {isSelected && (
                <div className="absolute top-3 right-3">
                  <Check className="w-4 h-4 text-primary" />
                </div>
              )}

              {/* Icon */}
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center text-xl mb-3"
                style={{ backgroundColor: `${template.color}20` }}
              >
                {template.icon}
              </div>

              {/* Content */}
              <div className="space-y-1">
                <h4 className="font-medium text-foreground">{template.name}</h4>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {template.description}
                </p>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1 mt-2">
                {template.tags.slice(0, 2).map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                    style={
                      isSelected || isHovered
                        ? { backgroundColor: `${template.color}20` }
                        : undefined
                    }
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Compact template selector for inline use
 */
export function ProfileTemplateSelectorCompact({
  selectedTemplateId,
  onSelect,
  disabled = false,
}: ProfileTemplateSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={selectedTemplateId === null ? "default" : "outline"}
        size="sm"
        onClick={() => onSelect(null)}
        disabled={disabled}
        className="gap-1"
      >
        📄 Blank
      </Button>

      {PROFILE_TEMPLATES.map((template) => (
        <Button
          key={template.id}
          variant={selectedTemplateId === template.id ? "default" : "outline"}
          size="sm"
          onClick={() => onSelect(template)}
          disabled={disabled}
          className="gap-1"
          style={
            selectedTemplateId === template.id
              ? { backgroundColor: template.color, borderColor: template.color }
              : undefined
          }
        >
          {template.icon} {template.name}
        </Button>
      ))}
    </div>
  );
}
