"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";

interface PdfViewerProps {
  transactionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
      // Cleanup when sidebar closes
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
      setError(null);
    }
  }, [open, transactionId]);

  const loadPdf = async () => {
    setLoading(true);
    setError(null);
    setPdfFilename(null);
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api"}/transactions/${transactionId}/source-pdf`);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}. ${errorText}`);
      }
      
      // Get PDF path from response headers for debugging
      const pdfPath = response.headers.get("X-PDF-Path");
      const pdfFilename = response.headers.get("X-PDF-Filename");
      
      if (pdfPath) {
        setPdfFilename(pdfPath);
        console.log(`📄 Loading PDF: ${pdfPath}`);
      } else if (pdfFilename) {
        setPdfFilename(pdfFilename);
        console.log(`📄 Loading PDF: ${pdfFilename}`);
      }
      
      const blob = await response.blob();
      
      // Create object URL for the PDF blob to use in iframe
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to load PDF";
      setError(errorMessage);
      
      // Try to extract PDF path from error message if available
      const pathMatch = errorMessage.match(/unlocked-statements[^"]+\.pdf|unlocked_statements[^"]+\.pdf/);
      if (pathMatch) {
        setPdfFilename(pathMatch[0]);
      }
      
      toast.error(`Failed to load PDF: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (pdfUrl) {
      const link = document.createElement("a");
      link.href = pdfUrl;
      link.download = `transaction-${transactionId}-source.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("PDF download started");
    }
  };

  const handleOpenChange = useCallback((newOpen: boolean) => {
    // Only allow opening, or closing if explicitly allowed (close button or ESC)
    if (newOpen) {
      onOpenChange(true);
    } else {
      // Only close if explicitly allowed
      if (allowCloseRef.current) {
        allowCloseRef.current = false;
        onOpenChange(false);
      }
      // Otherwise, ignore the close request (from outside click)
    }
  }, [onOpenChange]);

  const handleCloseClick = useCallback(() => {
    allowCloseRef.current = true;
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange} modal={false}>
      <SheetContent 
        side="right" 
        modal={false}
        className="w-full sm:max-w-4xl p-0 flex flex-col"
        onClose={handleCloseClick}
        onInteractOutside={(e) => {
          // Prevent closing when clicking outside - allow interaction with main content
          e.preventDefault();
          e.stopPropagation();
          return false;
        }}
        onPointerDownOutside={(e) => {
          // Prevent closing on pointer down outside
          e.preventDefault();
          e.stopPropagation();
          return false;
        }}
        onEscapeKeyDown={(e) => {
          // Allow ESC to close
          allowCloseRef.current = true;
          onOpenChange(false);
        }}
      >
        <SheetHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <SheetTitle>Source PDF Statement</SheetTitle>
              {pdfFilename && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono truncate max-w-md" title={pdfFilename}>
                  {pdfFilename}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              disabled={!pdfUrl}
              className="flex items-center gap-2"
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          </div>
        </SheetHeader>
        
        <div className="flex-1 overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                <span className="text-sm text-gray-400">Loading PDF...</span>
              </div>
            </div>
          )}
          
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-red-500 text-center px-6">
                <p className="font-semibold">Error loading PDF</p>
                <p className="text-sm mt-2">{error}</p>
              </div>
            </div>
          )}
          
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

