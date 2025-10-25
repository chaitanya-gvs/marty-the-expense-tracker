"use client";

import React, { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ModalSize = "sm" | "md" | "lg";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  size?: ModalSize;
  role?: "dialog" | "alertdialog";
  initialFocusRef?: React.RefObject<HTMLElement>;
  children: React.ReactNode;
  className?: string;
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

export function Modal({
  open,
  onClose,
  size = "md",
  role = "dialog",
  initialFocusRef,
  children,
  className,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onClose();
      }
    };

    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center"
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

          {/* Modal Panel */}
          <motion.div
            ref={modalRef}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "relative my-10 max-h-[calc(100vh-5rem)] overflow-hidden",
              "rounded-2xl border shadow-[0_10px_40px_rgba(0,0,0,0.45)]",
              "bg-[var(--modal-panel)] border-[var(--modal-border)]",
              sizeClasses[size],
              "max-md:w-[calc(100vw-24px)]",
              className
            )}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
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

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex items-start justify-between gap-4",
        "border-b px-6 py-4",
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
            className="text-lg font-semibold text-[var(--modal-text)] truncate"
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
            "hover:bg-slate-800/60 transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-slate-600"
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
  return (
    <div
      className={cn(
        "overflow-y-auto px-6 py-4",
        "max-h-[calc(70vh)]",
        "scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent",
        className
      )}
    >
      {children}
    </div>
  );
}

function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div
      className={cn(
        "sticky bottom-0 flex items-center justify-end gap-3",
        "border-t px-6 py-3",
        "bg-gradient-to-t from-[var(--modal-panel)] to-transparent",
        "border-[var(--modal-border)]",
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

