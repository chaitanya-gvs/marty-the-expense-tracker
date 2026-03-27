"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Transaction } from "@/lib/types";

type EditingField = keyof Transaction | null;

export interface KeyboardNavCallbacks {
  editingRow: string | null;
  editingField: EditingField;
  editingTagsForTransaction: string | null;
  editingCategoryForTransaction: string | null;
  isMultiSelectMode: boolean;
  selectedTransactionIds: Set<string>;
  handleSelectTransaction: (transactionId: string) => void;
  handleActionButtonClick: (transaction: Transaction, buttonIndex: number) => void;
  setEditingRow: (id: string | null) => void;
  setEditingField: (field: EditingField) => void;
  setEditingTagsForTransaction: (id: string | null) => void;
  setEditingCategoryForTransaction: (id: string | null) => void;
  setIsDeleteConfirmationOpen: (open: boolean) => void;
  setTransactionToDelete: (transaction: Transaction | null) => void;
  bodyScrollRef: React.MutableRefObject<HTMLDivElement | null>;
}

export interface KeyboardNavState {
  focusedRowIndex: number;
  focusedColumnId: string | null;
  isKeyboardNavigationMode: boolean;
  focusedActionButton: number;
  setFocusedRowIndex: (index: number) => void;
  setFocusedColumnId: (id: string | null) => void;
  setIsKeyboardNavigationMode: (active: boolean) => void;
  setFocusedActionButton: (index: number) => void;
  editableColumns: string[];
  getNextEditableColumn: (currentColumnId: string | null, direction?: "left" | "right") => string;
}

export function useTransactionKeyboardNav(
  allTransactions: Transaction[],
  callbacks: KeyboardNavCallbacks
): KeyboardNavState {
  const {
    editingRow,
    editingField,
    editingTagsForTransaction,
    editingCategoryForTransaction,
    isMultiSelectMode,
    selectedTransactionIds,
    handleSelectTransaction,
    handleActionButtonClick,
    setEditingRow,
    setEditingField,
    setEditingTagsForTransaction,
    setEditingCategoryForTransaction,
    setIsDeleteConfirmationOpen,
    setTransactionToDelete,
    bodyScrollRef,
  } = callbacks;

  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);
  const [focusedColumnId, setFocusedColumnId] = useState<string | null>(null);
  const [isKeyboardNavigationMode, setIsKeyboardNavigationMode] = useState(false);
  const [focusedActionButton, setFocusedActionButton] = useState<number>(-1);

  const editableColumns = useMemo(() => {
    const columns = ["description", "category", "tags", "actions"];
    if (isMultiSelectMode) {
      return ["select", ...columns];
    }
    return columns;
  }, [isMultiSelectMode]);

  const getNextEditableColumn = useCallback(
    (currentColumnId: string | null, direction: "left" | "right" = "right") => {
      if (!currentColumnId) return editableColumns[0];

      const currentIndex = editableColumns.indexOf(currentColumnId);
      if (currentIndex === -1) return editableColumns[0];

      if (direction === "right") {
        return editableColumns[currentIndex + 1] || editableColumns[0];
      } else {
        return editableColumns[currentIndex - 1] || editableColumns[editableColumns.length - 1];
      }
    },
    [editableColumns]
  );

  const scrollToFocusedCell = useCallback(() => {
    if (focusedRowIndex >= 0 && bodyScrollRef.current) {
      const tableBody = bodyScrollRef.current;
      const table = tableBody.querySelector("table");
      if (!table) return;

      const rows = table.querySelectorAll("tbody tr");
      const focusedRow = rows[focusedRowIndex] as HTMLElement;

      if (!focusedRow) return;

      focusedRow.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    }
  }, [focusedRowIndex, bodyScrollRef]);

  const prevFocusedRowIndex = useRef<number>(-1);
  const isUserNavigating = useRef<boolean>(false);

  useEffect(() => {
    if (
      isKeyboardNavigationMode &&
      focusedRowIndex >= 0 &&
      focusedRowIndex !== prevFocusedRowIndex.current &&
      isUserNavigating.current
    ) {
      prevFocusedRowIndex.current = focusedRowIndex;
      setTimeout(scrollToFocusedCell, 10);
    } else if (!isKeyboardNavigationMode) {
      prevFocusedRowIndex.current = -1;
      isUserNavigating.current = false;
    }
  }, [focusedRowIndex, isKeyboardNavigationMode, scrollToFocusedCell]);

  const handleKeyboardNavigation = useCallback(
    (e: KeyboardEvent) => {
      const { key } = e;
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Handle Cmd/Ctrl + Delete for bulk deletion
      if (
        (key === "Delete" || key === "Backspace") &&
        cmdOrCtrl &&
        isMultiSelectMode &&
        selectedTransactionIds.size > 0
      ) {
        e.preventDefault();
        setIsDeleteConfirmationOpen(true);
        setTransactionToDelete(null);
        return;
      }

      // Handle Cmd/Ctrl + Arrow keys for multi-select navigation
      if (cmdOrCtrl && isMultiSelectMode && (key === "ArrowUp" || key === "ArrowDown")) {
        e.preventDefault();
        let currentIndex = focusedRowIndex;
        if (currentIndex < 0 && allTransactions.length > 0) {
          currentIndex = 0;
          setFocusedRowIndex(0);
        }

        if (key === "ArrowUp" && currentIndex > 0) {
          const newIndex = currentIndex - 1;
          setFocusedRowIndex(newIndex);
          const transaction = allTransactions[newIndex];
          if (transaction) {
            handleSelectTransaction(transaction.id);
          }
        } else if (key === "ArrowDown" && currentIndex < allTransactions.length - 1) {
          const newIndex = currentIndex + 1;
          setFocusedRowIndex(newIndex);
          const transaction = allTransactions[newIndex];
          if (transaction) {
            handleSelectTransaction(transaction.id);
          }
        }
        return;
      }

      // Handle Tab key - should work like Enter (save and move) when in edit mode
      if (
        key === "Tab" &&
        (editingRow || editingField || editingTagsForTransaction || editingCategoryForTransaction)
      ) {
        return;
      }

      // Only handle other keys when not in edit mode
      if (editingRow || editingField || editingTagsForTransaction || editingCategoryForTransaction) {
        return;
      }

      switch (key) {
        case "Tab":
          e.preventDefault();
          isUserNavigating.current = false;
          if (focusedRowIndex >= 0 && focusedColumnId) {
            const nextColumn = getNextEditableColumn(focusedColumnId, e.shiftKey ? "left" : "right");
            setFocusedColumnId(nextColumn);

            if (nextColumn === editableColumns[0] && !e.shiftKey) {
              const nextRowIndex = Math.min(focusedRowIndex + 1, allTransactions.length - 1);
              setFocusedRowIndex(nextRowIndex);
            } else if (nextColumn === editableColumns[editableColumns.length - 1] && e.shiftKey) {
              const prevRowIndex = Math.max(focusedRowIndex - 1, 0);
              setFocusedRowIndex(prevRowIndex);
            }
          } else {
            setFocusedRowIndex(0);
            setFocusedColumnId(editableColumns[0]);
            setIsKeyboardNavigationMode(true);
          }
          break;

        case "Enter":
          e.preventDefault();
          isUserNavigating.current = false;
          if (focusedRowIndex >= 0 && focusedColumnId && focusedColumnId !== "select") {
            const transaction = allTransactions[focusedRowIndex];
            if (transaction) {
              if (focusedColumnId === "tags") {
                setEditingTagsForTransaction(transaction.id);
              } else if (focusedColumnId === "category") {
                setEditingCategoryForTransaction(transaction.id);
              } else if (focusedColumnId === "actions") {
                if (focusedActionButton >= 0) {
                  handleActionButtonClick(transaction, focusedActionButton);
                } else {
                  setFocusedActionButton(0);
                }
              } else {
                setEditingRow(transaction.id);
                setEditingField(focusedColumnId as EditingField);
              }
              setIsKeyboardNavigationMode(false);
            }
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (focusedRowIndex > 0) {
            isUserNavigating.current = true;
            setFocusedRowIndex(focusedRowIndex - 1);
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (focusedRowIndex < allTransactions.length - 1) {
            isUserNavigating.current = true;
            setFocusedRowIndex(focusedRowIndex + 1);
          }
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (focusedColumnId === "actions" && focusedActionButton > 0) {
            setFocusedActionButton(focusedActionButton - 1);
          } else if (focusedColumnId) {
            setFocusedColumnId(getNextEditableColumn(focusedColumnId, "left"));
            setFocusedActionButton(-1);
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (focusedColumnId === "actions" && focusedActionButton < 7) {
            setFocusedActionButton(focusedActionButton + 1);
          } else if (focusedColumnId) {
            setFocusedColumnId(getNextEditableColumn(focusedColumnId, "right"));
            setFocusedActionButton(-1);
          }
          break;

        case "Escape":
          e.preventDefault();
          if (focusedActionButton >= 0) {
            setFocusedActionButton(-1);
          } else {
            setIsKeyboardNavigationMode(false);
            setFocusedRowIndex(-1);
            setFocusedColumnId(null);
          }
          break;
      }
    },
    [
      editingRow,
      editingField,
      editingTagsForTransaction,
      editingCategoryForTransaction,
      focusedRowIndex,
      focusedColumnId,
      focusedActionButton,
      getNextEditableColumn,
      editableColumns,
      allTransactions,
      handleActionButtonClick,
      isMultiSelectMode,
      selectedTransactionIds,
      handleSelectTransaction,
      setEditingRow,
      setEditingField,
      setEditingTagsForTransaction,
      setEditingCategoryForTransaction,
      setIsDeleteConfirmationOpen,
      setTransactionToDelete,
    ]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      handleKeyboardNavigation(e);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyboardNavigation]);

  return {
    focusedRowIndex,
    focusedColumnId,
    isKeyboardNavigationMode,
    focusedActionButton,
    setFocusedRowIndex,
    setFocusedColumnId,
    setIsKeyboardNavigationMode,
    setFocusedActionButton,
    editableColumns,
    getNextEditableColumn,
  };
}
