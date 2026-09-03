"use client";

import React, { useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-is-mobile";

export type ModalSize = "sm" | "md" | "lg";
export type ModalPresentation = "auto" | "sheet" | "fullscreen" | "center";
type ResolvedPresentation = Exclude<ModalPresentation, "auto">;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: ModalSize;
  role?: "dialog" | "alertdialog";
  initialFocusRef?: React.RefObject<HTMLElement>;
  children: React.ReactNode;
  className?: string;
  /**
   * How the panel is housed. "auto" (default): desktop → centred panel;
   * mobile → bottom sheet for sm/md, full-screen for lg.
   */
  presentation?: ModalPresentation;
}

export interface ModalHeaderProps {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  onClose?: () => void;
  variant?: "split" | "transfer" | "link-parent" | "share";
  className?: string;
}

export interface ModalBodyProps {
  children: React.ReactNode;
  className?: string;
}

export interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: "w-[420px]",
  md: "w-[640px]",
  lg: "w-[820px]",
};

const variantColors: Record<string, { bg: string; text: string }> = {
  split: { bg: "bg-[#6366f1]/20", text: "text-[#6366f1]" },
  transfer: { bg: "bg-[#06b6d4]/20", text: "text-[#06b6d4]" },
  "link-parent": { bg: "bg-[#f59e0b]/20", text: "text-[#f59e0b]" },
  share: { bg: "bg-[#6366f1]/20", text: "text-[#6366f1]" },
};

// Lets Header/Body/Footer adapt to the housing without consumers passing props.
const PresentationContext = React.createContext<ResolvedPresentation>("center");

function resolvePresentation(
  presentation: ModalPresentation,
  size: ModalSize,
  isMobile: boolean
): ResolvedPresentation {
  if (presentation !== "auto") return presentation;
  if (!isMobile) return "center";
  return size === "lg" ? "fullscreen" : "sheet";
}

export function Modal({
  open,
  onClose,
  size = "md",
  role = "dialog",
  initialFocusRef,
  children,
  className,
  presentation = "auto",
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const resolved = resolvePresentation(presentation, size, isMobile);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;

      // Focus initial element or first focusable element
      const focusTarget = initialFocusRef?.current || modalRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      focusTarget?.focus();
    } else {
      // Restore focus when modal closes
      previousFocus.current?.focus();
    }
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    // Save whatever lock is already in place (e.g. Radix's, when this Modal is
    // opened over an open Sheet) and restore *that* on close — clearing to ""
    // used to break the underlying Sheet's scroll lock.
    const previousOverflow = document.body.style.overflow;
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  const isCenter = resolved === "center";

  const panelMotion = isCenter
    ? {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 8 },
        transition: { duration: 0.2 },
      }
    : reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15 },
      }
    : {
        initial: { y: "100%" },
        animate: { y: 0, transition: { type: "spring" as const, stiffness: 380, damping: 34 } },
        exit: { y: "100%", transition: { type: "tween" as const, duration: 0.18, ease: "easeIn" as const } },
      };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-[60]",
            isCenter && "flex items-start justify-center"
          )}
          role={role}
          aria-modal="true"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            ref={modalRef}
            {...panelMotion}
            className={cn(
              "bg-[var(--modal-panel)] border-[var(--modal-border)]",
              isCenter && [
                "relative my-10 max-h-[calc(100vh-5rem)] overflow-hidden",
                "rounded-2xl border shadow-[0_10px_40px_rgba(0,0,0,0.45)]",
                sizeClasses[size],
                "max-md:w-[calc(100vw-24px)]",
              ],
              resolved === "sheet" && [
                "absolute inset-x-0 bottom-0 flex flex-col overflow-hidden",
                "max-h-[92dvh] rounded-t-2xl border-t shadow-[0_-10px_40px_rgba(0,0,0,0.45)]",
                "pb-[env(safe-area-inset-bottom)]",
              ],
              resolved === "fullscreen" && [
                "absolute inset-0 flex flex-col overflow-hidden",
                "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
              ],
              className
            )}
          >
            {resolved === "sheet" && (
              <div aria-hidden className="h-1 w-9 shrink-0 rounded-full bg-border mx-auto mt-2 mb-1" />
            )}
            <PresentationContext.Provider value={resolved}>
              {children}
            </PresentationContext.Provider>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function ModalHeader({
  icon,
  title,
  subtitle,
  onClose,
  variant = "split",
  className,
}: ModalHeaderProps) {
  const colors = variantColors[variant] || variantColors.split;
  const headerId = React.useId();
  const compact = useContext(PresentationContext) !== "center";

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex items-start justify-between gap-4 shrink-0",
        "border-b",
        compact ? "px-4 py-3" : "px-6 py-4",
        "bg-[var(--modal-panel-header)] border-[var(--modal-border)]",
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {icon && (
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs",
                colors.bg,
                colors.text
              )}
            >
              {icon}
            </span>
          )}
          <h2
            id={headerId}
            className={cn(
              "font-semibold text-[var(--modal-text)] truncate",
              compact ? "text-base" : "text-lg"
            )}
          >
            {title}
          </h2>
        </div>
        {subtitle && (
          <p className="text-sm text-[var(--modal-muted)] mt-1">{subtitle}</p>
        )}
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-full",
            "text-[var(--modal-muted)] hover:text-[var(--modal-text)]",
            "hover:bg-muted/60 transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-ring"
          )}
          aria-label="Close modal"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function ModalBody({ children, className }: ModalBodyProps) {
  const compact = useContext(PresentationContext) !== "center";

  return (
    <div
      className={cn(
        "overflow-y-auto",
        compact ? "flex-1 min-h-0 px-4 py-3" : "px-6 py-4 max-h-[calc(70vh)]",
        "scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent",
        className
      )}
    >
      {children}
    </div>
  );
}

function ModalFooter({ children, className }: ModalFooterProps) {
  const compact = useContext(PresentationContext) !== "center";

  return (
    <div
      className={cn(
        "flex items-center border-t border-[var(--modal-border)]",
        compact
          ? "shrink-0 gap-2 px-4 py-3 bg-[var(--modal-panel)] [&>*]:flex-1"
          : "sticky bottom-0 justify-end gap-3 px-6 py-3 bg-gradient-to-t from-[var(--modal-panel)] to-transparent",
        className
      )}
    >
      {children}
    </div>
  );
}

Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;
