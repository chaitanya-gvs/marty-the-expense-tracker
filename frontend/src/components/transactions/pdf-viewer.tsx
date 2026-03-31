"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Download, Loader2, X, AlertCircle, RotateCcw, FileText } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PdfViewerProps {
  transactionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Parse a raw error message into something user-friendly
function parseErrorMessage(raw: string): string {
  // Try to extract "detail" from a JSON body embedded in the error string
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.detail) return parsed.detail;
    }
  } catch {
    // ignore parse failures
  }
  // Fall back to the HTTP status description
  if (raw.includes("401")) return "Not authenticated — check your session and try again.";
  if (raw.includes("403")) return "Access denied — you don't have permission to view this PDF.";
  if (raw.includes("404")) return "PDF not found — the source file may have been moved or deleted.";
  if (raw.includes("500")) return "Server error — the PDF could not be retrieved right now.";
  return "Something went wrong while loading the PDF.";
}

// Extract just the filename from a full path
function extractFilename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function PdfViewer({ transactionId, open, onOpenChange }: PdfViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState<string | null>(null);
  const allowCloseRef = useRef(false);

  useEffect(() => {
    if (open && transactionId) {
      loadPdf();
    } else {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
      setError(null);
      setPdfFilename(null);
    }
  }, [open, transactionId]);

  const loadPdf = async () => {
    setLoading(true);
    setError(null);
    setPdfUrl(null);
    setPdfFilename(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api"}/transactions/${transactionId}/source-pdf`
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}. ${errorText}`);
      }

      const pdfPath = response.headers.get("X-PDF-Path");
      const pdfFilenameHeader = response.headers.get("X-PDF-Filename");
      const rawPath = pdfPath || pdfFilenameHeader;
      if (rawPath) {
        setPdfFilename(extractFilename(rawPath));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Failed to load PDF";
      const friendlyMessage = parseErrorMessage(rawMessage);
      setError(friendlyMessage);

      // Still try to extract a filename from the raw error for display
      const pathMatch = rawMessage.match(/unlocked-statements[^"]+\.pdf|unlocked_statements[^"]+\.pdf/);
      if (pathMatch) {
        setPdfFilename(extractFilename(pathMatch[0]));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (pdfUrl) {
      const link = document.createElement("a");
      link.href = pdfUrl;
      link.download = pdfFilename ?? `transaction-${transactionId}-source.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("PDF download started");
    }
  };

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen) {
        onOpenChange(true);
      } else {
        if (allowCloseRef.current) {
          allowCloseRef.current = false;
          onOpenChange(false);
        }
      }
    },
    [onOpenChange]
  );

  const handleCloseClick = useCallback(() => {
    allowCloseRef.current = true;
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange} modal={false}>
      <SheetContent
        side="right"
        modal={false}
        hideCloseButton
        className="w-full sm:max-w-4xl p-0 flex flex-col"
        onInteractOutside={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onEscapeKeyDown={() => {
          allowCloseRef.current = true;
          onOpenChange(false);
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <SheetHeader className="px-5 py-3.5 border-b shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* Icon + title block */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-muted/60 border border-border/50 flex items-center justify-center flex-shrink-0">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-sm font-semibold leading-tight">
                  Source PDF Statement
                </SheetTitle>
                {pdfFilename && (
                  <p
                    className="text-[11px] text-muted-foreground/60 font-mono mt-0.5 truncate max-w-xs"
                    title={pdfFilename}
                  >
                    {pdfFilename}
                  </p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownload}
                disabled={!pdfUrl}
                className="h-8 gap-1.5 text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                Download
              </Button>
              <button
                type="button"
                onClick={handleCloseClick}
                className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </SheetHeader>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden relative">
          {/* Loading */}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-muted-foreground/50" />
                <span className="text-sm text-muted-foreground/60">Loading PDF…</span>
              </div>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background">
              <div className="flex flex-col items-center gap-4 text-center px-8 max-w-sm">
                <div className="h-12 w-12 rounded-2xl bg-[#F44D4D]/10 border border-[#F44D4D]/20 flex items-center justify-center">
                  <AlertCircle className="h-6 w-6 text-[#F44D4D]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">
                    Could not load PDF
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {error}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadPdf}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Try again
                </Button>
              </div>
            </div>
          )}

          {/* PDF iframe */}
          {pdfUrl && !loading && !error && (
            <iframe
              src={pdfUrl}
              className="w-full h-full border-0"
              title="PDF Statement"
              style={{ minHeight: "100%" }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
