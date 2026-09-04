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

interface ModalContextValue {
  /** Resolved housing, so Header/Body/Footer adapt without consumers passing props. */
  presentation: ResolvedPresentation;
  /** Id the panel points `aria-labelledby` at; ModalHeader owns the matching <h2>. */
  titleId: string;
}

const PresentationContext = React.createContext<ModalContextValue>({
  presentation: "center",
  titleId: "",
});

/** Focusable descendants used for initial focus and the Tab trap. */
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function getFocusable(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return [];
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("aria-hidden") !== "true" &&
      !(el instanceof HTMLInputElement && el.type === "hidden") &&
      // Exclude elements not actually rendered (display:none ancestor, etc.);
      // offsetParent is null for fixed-position elements too, so fall back to
      // getClientRects() which is unaffected by position:fixed.
      (el.offsetParent !== null || el.getClientRects().length > 0)
  );
}

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
  const titleId = React.useId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      // Restore focus when modal closes
      previousFocus.current?.focus();
      return;
    }

    previousFocus.current = document.activeElement as HTMLElement;

    // Focus initial element or first focusable element
    const focus = () => {
      const target = initialFocusRef?.current || getFocusable(modalRef.current)[0];
      target?.focus();
    };

    focus();

    // A Sheet closing underneath this Modal restores focus to its own trigger
    // when its exit animation finishes, which steals the focus we just set.
    // Re-assert once that window has passed, unless focus is already inside.
    const timer = window.setTimeout(() => {
      const panel = modalRef.current;
      if (!panel) return; // modal closed in the meantime
      // A Radix popper (Select/Popover/DropdownMenu) opened from inside this
      // Modal portals its content to <body>, outside `panel`, so don't steal
      // focus back from it here.
      if (document.activeElement?.closest('[data-radix-popper-content-wrapper]')) return;
      if (!panel.contains(document.activeElement)) focus();
    }, 350);

    return () => window.clearTimeout(timer);
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Radix dismissable layers (Select/Popover/Dialog nested inside this
      // Modal) call preventDefault on their capture-phase document listener;
      // honouring that keeps Escape from closing the whole Modal as well.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };

    // Save whatever lock is already in place (e.g. an inline lock set by an
    // outer Modal) and restore *that* on close, so Modal-over-Modal does not
    // leave the page unlocked. Harmless otherwise: Radix locks scrolling with
    // a `data-scroll-locked` stylesheet, not an inline body style.
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

  // Reduced motion wins over every presentation, centre included.
  const panelMotion = reduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.15 },
      }
    : isCenter
    ? {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: 8 },
        transition: { duration: 0.2 },
      }
    : {
        initial: { y: "100%" },
        animate: { y: 0, transition: { type: "spring" as const, stiffness: 380, damping: 34 } },
        exit: { y: "100%", transition: { type: "tween" as const, duration: 0.18, ease: "easeIn" as const } },
      };

  // Minimal focus trap: cycle Tab / Shift+Tab among the panel's focusables.
  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = modalRef.current;
    if (!panel) return;
    // Radix poppers opened from inside the Modal portal to <body> but still
    // bubble through the React tree — leave their own Tab handling alone.
    if (!panel.contains(e.target as Node)) return;

    const focusable = getFocusable(panel);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && panel.contains(active);

    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-[60]",
            isCenter && "flex items-start justify-center"
          )}
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
            role={role}
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={handlePanelKeyDown}
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
                // Several consumers wrap Body+Footer in a <form>; a block box
                // there would break the flex chain and stop Body scrolling.
                "[&>form]:flex [&>form]:flex-col [&>form]:flex-1 [&>form]:min-h-0",
              ],
              resolved === "fullscreen" && [
                "absolute inset-0 flex flex-col overflow-hidden",
                "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
                "[&>form]:flex [&>form]:flex-col [&>form]:flex-1 [&>form]:min-h-0",
              ],
              className
            )}
          >
            {resolved === "sheet" && (
              <div aria-hidden className="h-1 w-9 shrink-0 rounded-full bg-border mx-auto mt-2 mb-1" />
            )}
            <PresentationContext.Provider value={{ presentation: resolved, titleId }}>
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
  const { presentation, titleId } = useContext(PresentationContext);
  const fallbackId = React.useId();
  // The panel points aria-labelledby at the Modal's titleId; own the <h2> for it.
  const headerId = titleId || fallbackId;
  const compact = presentation !== "center";

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

/**
 * Scrollable region of the panel.
 *
 * In the mobile presentations (`sheet` / `fullscreen`) the Body is
 * `flex-1 min-h-0 overflow-y-auto`, so it only scrolls when it is a **flex
 * child of the panel** — either a direct child of `Modal`, or a child of a
 * single `<form>` placed directly under `Modal` (the panel gives that form
 * `flex flex-col flex-1 min-h-0`). Any other wrapper element between the panel
 * and the Body breaks the chain: the Body grows unbounded and the Footer is
 * pushed off-screen.
 */
function ModalBody({ children, className }: ModalBodyProps) {
  const compact = useContext(PresentationContext).presentation !== "center";

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
  const compact = useContext(PresentationContext).presentation !== "center";

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
