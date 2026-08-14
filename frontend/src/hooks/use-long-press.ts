"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseLongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  delay?: number;
  moveThreshold?: number;
}

interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

/**
 * Pointer-Events-based long-press detection with a movement threshold, so a
 * vertical scroll gesture starting on a row cancels the long-press instead of
 * firing it (see 2026-08-14-mobile-transactions-list-design.md's "Gesture
 * note" — this is what keeps long-press from fighting the list's scroll).
 */
export function useLongPress({
  onLongPress,
  onClick,
  delay = 500,
  moveThreshold = 10,
}: UseLongPressOptions): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const firedLongPress = useRef(false);
  const cancelled = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPos.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only primary button / primary touch contact
      if (e.button !== undefined && e.button !== 0) return;
      firedLongPress.current = false;
      cancelled.current = false;
      startPos.current = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        firedLongPress.current = true;
        onLongPress();
      }, delay);
    },
    [delay, onLongPress]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!startPos.current) return;
      const dx = Math.abs(e.clientX - startPos.current.x);
      const dy = Math.abs(e.clientY - startPos.current.y);
      if (dx > moveThreshold || dy > moveThreshold) {
        cancelled.current = true;
        clear();
      }
    },
    [moveThreshold, clear]
  );

  const onPointerUp = useCallback(() => {
    const wasLongPress = firedLongPress.current;
    const wasCancelled = cancelled.current;
    clear();
    if (!wasLongPress && !wasCancelled) {
      onClick?.();
    }
  }, [clear, onClick]);

  const onPointerLeave = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerCancel = useCallback(() => {
    // Browser recognized the touch as a scroll/other gesture; no pointerup
    // will follow. Behave like onPointerLeave: clear without firing either
    // callback.
    clear();
  }, [clear]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Suppress the native browser context menu on long-press (desktop right-click
    // emulation / some Android browsers fire this on touch-and-hold).
    e.preventDefault();
  }, []);

  // Ensure a pending timer doesn't fire onLongPress after the component
  // (e.g. a list row) unmounts mid-press.
  useEffect(() => {
    return () => {
      clear();
    };
  }, [clear]);

  return {
    onPointerDown,
    onPointerUp,
    onPointerMove,
    onPointerLeave,
    onPointerCancel,
    onContextMenu,
  };
}
