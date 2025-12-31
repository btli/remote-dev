"use client";

import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Download,
  Upload,
  FileJson,
  CheckCircle,
  AlertCircle,
  Copy,
  Loader2,
  FileCheck,
} from "lucide-react";

interface ProfileExportImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "export" | "import";
  exportData?: string | null;
  onImport?: (data: string) => Promise<{ success: boolean; error?: string }>;
  isLoading?: boolean;
}

/**
 * ProfileExportImport - Modal for exporting and importing profiles
 *
 * Export mode: Displays JSON and allows download
 * Import mode: Accepts file upload or paste, validates schema
 */
export function ProfileExportImport({
  open,
  onOpenChange,
  mode,
  exportData,
  onImport,
  isLoading = false,
}: ProfileExportImportProps) {
  const [importData, setImportData] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCopy = useCallback(async () => {
    if (exportData) {
      await navigator.clipboard.writeText(exportData);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [exportData]);

  const handleDownload = useCallback(() => {
    if (exportData) {
      const blob = new Blob([exportData], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `profile-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }, [exportData]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          setImportData(content);
          setImportError(null);
          setImportSuccess(false);

          // Validate JSON
          try {
            const parsed = JSON.parse(content);
            if (!parsed.version || !parsed.profile?.name) {
              setImportError("Invalid profile format: missing required fields");
            }
          } catch {
            setImportError("Invalid JSON format");
          }
        };
        reader.readAsText(file);
      }
    },
    []
  );

  const handleImport = useCallback(async () => {
    if (!onImport || !importData) return;

    setImportError(null);
    setImportSuccess(false);

    // Validate JSON first
    try {
      const parsed = JSON.parse(importData);
      if (!parsed.version || !parsed.profile?.name) {
        setImportError("Invalid profile format: missing required fields");
        return;
      }
    } catch {
      setImportError("Invalid JSON format");
      return;
    }

    const result = await onImport(importData);
    if (result.success) {
      setImportSuccess(true);
      setTimeout(() => {
        onOpenChange(false);
        setImportData("");
        setImportSuccess(false);
      }, 1500);
    } else {
      setImportError(result.error || "Import failed");
    }
  }, [importData, onImport, onOpenChange]);

  const handleTextChange = useCallback((value: string) => {
    setImportData(value);
    setImportError(null);
    setImportSuccess(false);

    if (value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (!parsed.version || !parsed.profile?.name) {
          setImportError("Invalid profile format: missing required fields");
        }
      } catch {
        setImportError("Invalid JSON format");
      }
    }
  }, []);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setImportData("");
    setImportError(null);
    setImportSuccess(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "export" ? (
              <>
                <Download className="w-5 h-5 text-primary" />
                Export Profile
              </>
            ) : (
              <>
                <Upload className="w-5 h-5 text-primary" />
                Import Profile
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {mode === "export"
              ? "Download or copy the profile configuration as JSON"
              : "Import a profile from a JSON file or paste the configuration"}
          </DialogDescription>
        </DialogHeader>

        {mode === "export" ? (
          <div className="space-y-4">
            {/* Export Preview */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                Profile Configuration
              </Label>
              <div className="relative">
                <Textarea
                  value={exportData || ""}
                  readOnly
                  className="h-64 font-mono text-xs bg-muted/50 resize-none"
                  placeholder="Loading..."
                />
                {exportData && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopy}
                    className="absolute top-2 right-2 h-8 w-8"
                  >
                    {copied ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
            </div>

            {/* Export Info */}
            {exportData && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileJson className="w-4 h-4" />
                <span>
                  {new Blob([exportData]).size.toLocaleString()} bytes
                </span>
                <Badge variant="secondary" className="text-[10px]">
                  JSON
                </Badge>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* File Upload */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                Upload File
              </Label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                  "hover:border-primary/50 hover:bg-muted/50",
                  importData ? "border-primary/30 bg-primary/5" : "border-border"
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {importData ? (
                  <div className="flex items-center justify-center gap-2 text-primary">
                    <FileCheck className="w-5 h-5" />
                    <span className="text-sm font-medium">File loaded</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Click to select a JSON file or drag and drop
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  Or paste JSON
                </span>
              </div>
            </div>

            {/* Paste JSON */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">
                Paste Configuration
              </Label>
              <Textarea
                value={importData}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder='{"version": 1, "profile": {...}, "configs": {...}}'
                className={cn(
                  "h-32 font-mono text-xs resize-none",
                  importError && "border-destructive",
                  importSuccess && "border-green-500"
                )}
              />
            </div>

            {/* Validation Status */}
            {importError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4" />
                {importError}
              </div>
            )}
            {importSuccess && (
              <div className="flex items-center gap-2 text-sm text-green-500">
                <CheckCircle className="w-4 h-4" />
                Profile imported successfully!
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          {mode === "export" ? (
            <Button onClick={handleDownload} disabled={!exportData || isLoading}>
              <Download className="w-4 h-4 mr-2" />
              Download JSON
            </Button>
          ) : (
            <Button
              onClick={handleImport}
              disabled={!importData || !!importError || isLoading || importSuccess}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Import Profile
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook to manage export/import modal state
 */
export function useProfileExportImport() {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"export" | "import">("export");
  const [exportData, setExportData] = useState<string | null>(null);

  const openExport = useCallback((data: string) => {
    setExportData(data);
    setMode("export");
    setIsOpen(true);
  }, []);

  const openImport = useCallback(() => {
    setExportData(null);
    setMode("import");
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setExportData(null);
  }, []);

  return {
    isOpen,
    mode,
    exportData,
    setIsOpen,
    openExport,
    openImport,
    close,
  };
}
