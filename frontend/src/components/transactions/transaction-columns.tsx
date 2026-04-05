"use client";

import React, { RefObject } from "react";
import { createColumnHelper, ColumnDef, Row } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CalendarDays,
  Tag as TagIcon,
  Users,
  CreditCard,
  Wallet,
  Building2,
  FolderOpen,
  IndianRupee,
  Mail,
  CheckSquare,
  Square,
  Split,
  RefreshCcw,
  AlertTriangle,
  Trash2,
  FileText,
  Layers,
  ChevronDown,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Transaction, Tag, Category } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format-utils";
import { TransactionInlineEdit } from "./transaction-inline-edit";
import { InlineCategoryDropdown } from "./inline-category-dropdown";
import { InlineTagDropdown } from "./inline-tag-dropdown";
import { TagPill } from "./tag-pill";
import { InlineDateCell } from "./inline-date-cell";

const columnHelper = createColumnHelper<Transaction>();

// Helper function to process account names and get icons
function processAccountInfo(accountName: string) {
  if (accountName.toLowerCase().includes("splitwise")) {
    return {
      processedName: "Splitwise",
      icon: <Users className="h-3 w-3 mr-1" />,
      isCreditCard: false,
      isSplitwise: true,
    };
  }

  const words = accountName.split(" ");
  const processedName = words.slice(0, -2).join(" ");
  const isCreditCard = accountName.toLowerCase().includes("credit");
  const icon = isCreditCard ? (
    <CreditCard className="h-3 w-3 mr-1" />
  ) : (
    <Wallet className="h-3 w-3 mr-1" />
  );

  return { processedName, icon, isCreditCard, isSplitwise: false };
}

// Helper function to convert string tags to Tag objects
function convertStringTagsToObjects(tagNames: string[], allTags: Tag[]): Tag[] {
  return tagNames
    .map((tagName) => allTags.find((tag) => tag.name === tagName))
    .filter(Boolean) as Tag[];
}

export interface TransactionColumnCallbacks {
  // Editing state
  editingRow: string | null;
  editingField: keyof Transaction | null;
  editingTagsForTransaction: string | null;
  editingCategoryForTransaction: string | null;

  // Multi-select state
  isMultiSelectMode: boolean;
  selectedTransactionIds: Set<string>;
  isAllSelected: boolean;
  isIndeterminate: boolean;

  // Keyboard nav state
  isKeyboardNavigationMode: boolean;
  focusedRowIndex: number;
  focusedColumnId: string | null;
  focusedActionButton: number;

  // Data (refs so column callbacks always read latest values without
  // triggering a columns useMemo rebuild on every data update)
  allTagsRef: RefObject<Tag[]>;
  allCategoriesRef: RefObject<Category[]>;
  allTransactionsRef: RefObject<Transaction[]>;
  allTransactionsUnfilteredRef: RefObject<Transaction[]>;
  editingCategoryForTransactionRef: RefObject<string | null>;
  expandedGroupedExpenses: Set<string>;

  // Editable columns (from keyboard nav hook)
  editableColumns: string[];
  getNextEditableColumn: (currentColumnId: string | null, direction?: "left" | "right") => string;

  // Selection handlers
  handleSelectAll: () => void;
  handleSelectTransaction: (transactionId: string) => void;

  // Highlight handlers
  handleHighlightTransactions: (ids: string[]) => void;
  handleClearHighlight: () => void;

  // Group expense handler
  toggleGroupExpense: (transaction: Transaction) => void;

  // Update mutation ref (for tag removal, flag toggle, direction toggle)
  onUpdateTransactionRef: RefObject<(params: { id: string; updates: Partial<Transaction> }) => Promise<unknown>>;

  // Editing state setters
  setEditingRow: (id: string | null) => void;
  setEditingField: (field: keyof Transaction | null) => void;
  setEditingTagsForTransaction: (id: string | null) => void;
  setEditingCategoryForTransaction: (id: string | null) => void;

  // Keyboard nav setters
  setFocusedRowIndex: (index: number) => void;
  setFocusedColumnId: (id: string | null) => void;
  setIsKeyboardNavigationMode: (active: boolean) => void;

  // Modal/drawer setters
  setSelectedTransactionForSplit: (t: Transaction | null) => void;
  setIsSplitEditorOpen: (open: boolean) => void;
  setDrawerTransaction: (t: Transaction | null) => void;
  setDrawerVariant: (v: "split" | "transfer" | "groupedExpense" | null) => void;
  setIsDrawerOpen: (open: boolean) => void;
  setGroupExpenseFromTransaction: (t: Transaction | null) => void;
  setIsGroupExpenseSearchModalOpen: (open: boolean) => void;
  setSelectedTransactionForSplitting: (t: Transaction | null) => void;
  setIsSplitTransactionModalOpen: (open: boolean) => void;
  setEmailLinksTransaction: (t: Transaction | null) => void;
  setIsEmailLinksDrawerOpen: (open: boolean) => void;
  setTransactionToDelete: (t: Transaction | null) => void;
  setIsDeleteConfirmationOpen: (open: boolean) => void;
  setPdfViewerTransactionId: (id: string | null) => void;
  setIsPdfViewerOpen: (open: boolean) => void;
}

export function buildTransactionColumns(
  callbacks: TransactionColumnCallbacks
): ColumnDef<Transaction>[] {
  const {
    editingRow,
    editingField,
    editingTagsForTransaction,
    editingCategoryForTransaction,
    isMultiSelectMode,
    selectedTransactionIds,
    isAllSelected,
    isIndeterminate,
    isKeyboardNavigationMode,
    focusedRowIndex,
    focusedColumnId,
    focusedActionButton,
    allTagsRef,
    allCategoriesRef,
    allTransactionsRef,
    allTransactionsUnfilteredRef,
    editingCategoryForTransactionRef,
    expandedGroupedExpenses,
    editableColumns,
    getNextEditableColumn,
    handleSelectAll,
    handleSelectTransaction,
    handleHighlightTransactions,
    handleClearHighlight,
    toggleGroupExpense,
    onUpdateTransactionRef,
    setEditingRow,
    setEditingField,
    setEditingTagsForTransaction,
    setEditingCategoryForTransaction,
    setFocusedRowIndex,
    setFocusedColumnId,
    setIsKeyboardNavigationMode,
    setSelectedTransactionForSplit,
    setIsSplitEditorOpen,
    setDrawerTransaction,
    setDrawerVariant,
    setIsDrawerOpen,
    setGroupExpenseFromTransaction,
    setIsGroupExpenseSearchModalOpen,
    setSelectedTransactionForSplitting,
    setIsSplitTransactionModalOpen,
    setEmailLinksTransaction,
    setIsEmailLinksDrawerOpen,
    setTransactionToDelete,
    setIsDeleteConfirmationOpen,
    setPdfViewerTransactionId,
    setIsPdfViewerOpen,
  } = callbacks;

  const baseColumns: ColumnDef<Transaction>[] = [];

  // Only add selection column when in multi-select mode
  if (isMultiSelectMode) {
    baseColumns.push(
      columnHelper.display({
        id: "select",
        header: () => (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSelectAll}
            className="h-8 w-8 p-0"
          >
            {isAllSelected ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : isIndeterminate ? (
              <div className="h-4 w-4 border-2 border-primary/50 rounded bg-primary/10" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </Button>
        ),
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleSelectTransaction(row.original.id)}
            className="h-8 w-8 p-0"
          >
            {selectedTransactionIds.has(row.original.id) ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4" />
            )}
          </Button>
        ),
        size: 40,
      })
    );
  }

  return [
    ...baseColumns,

    // Date column
    columnHelper.accessor("date", {
      id: "date",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 px-2 gap-1 text-xs font-medium uppercase tracking-wide w-full justify-start"
        >
          <CalendarDays className="size-3" />
          Date
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-1 h-3 w-3 text-primary shrink-0" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-1 h-3 w-3 text-primary shrink-0" />
          ) : (
            <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/25 shrink-0" />
          )}
        </Button>
      ),
      size: 120,
      enableResizing: false,
      enableSorting: true,
      sortingFn: (rowA, rowB) => rowA.original.date.localeCompare(rowB.original.date),
      cell: ({ row }) => <InlineDateCell transaction={row.original} />,
    }),

    // Description column (resizable)
    columnHelper.accessor("description", {
      header: () => (
        <div className="flex items-center gap-1">
          <FileText className="h-3 w-3" />
          Description
        </div>
      ),
      enableResizing: true,
      minSize: 180,
      maxSize: 900,
      size: 420,
      cell: ({ getValue, row }) => {
        const isEditing = editingRow === row.original.id && editingField === "description";

        if (isEditing) {
          return (
            <TransactionInlineEdit
              transaction={row.original}
              field="description"
              onCancel={() => {
                setEditingRow(null);
                setEditingField(null);
                const currentRowIndex = allTransactionsRef.current!.findIndex(
                  (t) => t.id === row.original.id
                );
                setFocusedRowIndex(currentRowIndex);
                setFocusedColumnId("description");
                setIsKeyboardNavigationMode(true);
              }}
              onSuccess={() => {
                setEditingRow(null);
                setEditingField(null);
                // Don't reset focus to description if we already Tab-navigated to
                // category editing — the async save fires after onTabNext has already
                // moved focus, so overriding it here causes the category dropdown to
                // flicker (columns rebuild → Radix Popover re-initializes).
                if (!editingCategoryForTransactionRef.current) {
                  const currentRowIndex = allTransactionsRef.current!.findIndex(
                    (t) => t.id === row.original.id
                  );
                  setFocusedRowIndex(currentRowIndex);
                  setFocusedColumnId("description");
                  setIsKeyboardNavigationMode(true);
                }
              }}
              onTabNext={() => {
                setEditingRow(null);
                setEditingField(null);

                const currentRowIndex = allTransactionsRef.current!.findIndex(
                  (t) => t.id === row.original.id
                );
                const nextColumn = getNextEditableColumn("description", "right");

                if (nextColumn === editableColumns[0]) {
                  const nextRowIndex = Math.min(currentRowIndex + 1, allTransactionsRef.current!.length - 1);
                  const nextTransaction = allTransactionsRef.current![nextRowIndex];
                  if (nextTransaction) {
                    setFocusedRowIndex(nextRowIndex);
                    setFocusedColumnId(nextColumn);
                    if (nextColumn === "description") {
                      setEditingRow(nextTransaction.id);
                      setEditingField("description");
                    } else if (nextColumn === "category") {
                      setEditingCategoryForTransaction(nextTransaction.id);
                    } else if (nextColumn === "tags") {
                      setEditingTagsForTransaction(nextTransaction.id);
                    }
                  }
                } else {
                  setFocusedRowIndex(currentRowIndex);
                  setFocusedColumnId(nextColumn);
                  if (nextColumn === "description") {
                    setEditingRow(row.original.id);
                    setEditingField("description");
                  } else if (nextColumn === "category") {
                    setEditingCategoryForTransaction(row.original.id);
                  } else if (nextColumn === "tags") {
                    setEditingTagsForTransaction(row.original.id);
                  }
                }
                setIsKeyboardNavigationMode(true);
              }}
              onTabPrevious={() => {
                setEditingRow(null);
                setEditingField(null);

                const currentRowIndex = allTransactionsRef.current!.findIndex(
                  (t) => t.id === row.original.id
                );
                const prevColumn = getNextEditableColumn("description", "left");

                if (prevColumn === editableColumns[editableColumns.length - 1]) {
                  const prevRowIndex = Math.max(currentRowIndex - 1, 0);
                  const prevTransaction = allTransactionsRef.current![prevRowIndex];
                  if (prevTransaction) {
                    setFocusedRowIndex(prevRowIndex);
                    setFocusedColumnId(prevColumn);
                    if (prevColumn === "description") {
                      setEditingRow(prevTransaction.id);
                      setEditingField("description");
                    } else if (prevColumn === "category") {
                      setEditingCategoryForTransaction(prevTransaction.id);
                    } else if (prevColumn === "tags") {
                      setEditingTagsForTransaction(prevTransaction.id);
                    }
                  }
                } else {
                  setFocusedRowIndex(currentRowIndex);
                  setFocusedColumnId(prevColumn);
                  if (prevColumn === "description") {
                    setEditingRow(row.original.id);
                    setEditingField("description");
                  } else if (prevColumn === "category") {
                    setEditingCategoryForTransaction(row.original.id);
                  } else if (prevColumn === "tags") {
                    setEditingTagsForTransaction(row.original.id);
                  }
                }
                setIsKeyboardNavigationMode(true);
              }}
            />
          );
        }

        const description = getValue();
        const fullText = description;
        const isGroupedExpense = row.original.is_grouped_expense;
        const isExpanded = row.original.transaction_group_id
          ? expandedGroupedExpenses.has(row.original.transaction_group_id)
          : false;

        return (
          <div
            className="cursor-pointer hover:bg-muted/50 p-2 rounded"
            onClick={(e) => {
              e.stopPropagation();
              setEditingRow(row.original.id);
              setEditingField("description");
            }}
          >
            <div className="flex items-center gap-2">
              {isGroupedExpense && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroupExpense(row.original);
                  }}
                  className="p-1 hover:bg-accent rounded flex-shrink-0"
                >
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-180")}
                  />
                </button>
              )}
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="flex items-center gap-1">
                  <div className="font-medium text-sm truncate" title={fullText}>
                    {description}
                  </div>
                  {isGroupedExpense && (
                    <Layers className="h-3 w-3 text-violet-300 flex-shrink-0" />
                  )}
                  {row.original.source_file && !row.original.account?.toLowerCase().includes("splitwise") && (
                    <button
                      className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex-shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPdfViewerTransactionId(row.original.id);
                        setIsPdfViewerOpen(true);
                      }}
                      title="View source PDF"
                    >
                      <FileText className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      },
    }),

    // Amount column with color coding
    columnHelper.accessor("amount", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="h-8 px-2 gap-1 text-xs font-medium uppercase tracking-wide justify-end w-full"
        >
          <IndianRupee className="size-3" />
          Amount
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-1 h-3 w-3 text-primary shrink-0" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-1 h-3 w-3 text-primary shrink-0" />
          ) : (
            <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/25 shrink-0" />
          )}
        </Button>
      ),
      sortingFn: (rowA, rowB) => {
        const getEffectiveAmount = (row: Row<Transaction>) => {
          const isShared = row.original.is_shared;
          const splitAmount = row.original.split_share_amount;
          return isShared && splitAmount ? splitAmount : row.original.amount;
        };
        return getEffectiveAmount(rowA) - getEffectiveAmount(rowB);
      },
      cell: ({ getValue, row }) => {
        const totalAmount = getValue();
        const splitAmount = row.original.split_share_amount;
        const netAmount = row.original.net_amount;
        const direction = row.original.direction;
        const isShared = row.original.is_shared;

        const hasRefunds = netAmount !== undefined && netAmount < totalAmount;

        let displayAmount: number;
        if (isShared && splitAmount !== undefined && splitAmount !== null) {
          displayAmount = splitAmount;
        } else if (hasRefunds && netAmount !== undefined && netAmount > 0) {
          displayAmount = netAmount;
        } else {
          displayAmount = totalAmount;
        }

        const showTotal = displayAmount !== totalAmount;
        const showNet =
          isShared &&
          hasRefunds &&
          splitAmount !== undefined &&
          splitAmount !== null &&
          netAmount !== undefined &&
          netAmount > 0 &&
          netAmount !== splitAmount &&
          netAmount !== totalAmount;

        return (
          <div className="flex flex-col items-end whitespace-nowrap">
            <div
              className={cn(
                "group/pill font-mono font-semibold text-sm inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-md tabular-nums cursor-pointer select-none transition-colors duration-150",
                direction === "debit"
                  ? "bg-[#F44D4D]/10 text-[#F44D4D] hover:bg-[#F44D4D]/20"
                  : "bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
              )}
              onClick={async (e) => {
                e.stopPropagation();
                const nextDirection = direction === "debit" ? "credit" : "debit";
                try {
                  await onUpdateTransactionRef.current!({
                    id: row.original.id,
                    updates: { direction: nextDirection },
                  });
                  toast.success(`Marked as ${nextDirection === "credit" ? "credit (money in)" : "debit (money out)"}`);
                } catch {
                  toast.error("Failed to toggle transaction direction");
                }
              }}
              title={`Click to mark as ${direction === "debit" ? "credit" : "debit"}`}
            >
              <span className="group-hover/pill:hidden flex items-center">
                {direction === "debit"
                  ? <TrendingDown className="h-3 w-3 shrink-0" />
                  : <TrendingUp className="h-3 w-3 shrink-0" />
                }
              </span>
              <RefreshCcw className="h-3 w-3 shrink-0 hidden group-hover/pill:inline-block" />
              {formatCurrency(displayAmount)}
            </div>
            {showTotal && (
              <div className="text-xs text-muted-foreground mt-1 text-right font-mono">
                Total: {formatCurrency(totalAmount)}
              </div>
            )}
            {showNet && (
              <div className="text-xs text-muted-foreground mt-0.5 text-right font-mono">
                Net: {formatCurrency(netAmount)}
              </div>
            )}
          </div>
        );
      },
      size: 120,
    }),

    // Account column
    columnHelper.accessor("account", {
      header: () => (
        <div className="flex items-center gap-1">
          <Building2 className="h-3 w-3" />
          Account
        </div>
      ),
      cell: ({ getValue }) => {
        const { processedName, icon, isCreditCard, isSplitwise } = processAccountInfo(getValue());
        return (
          <div className="whitespace-nowrap" title={getValue()}>
            <div
              className={cn(
                "font-semibold text-sm inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md max-w-[120px] overflow-hidden",
                isSplitwise
                  ? "text-violet-300 bg-violet-400/15"
                  : isCreditCard
                  ? "text-amber-300 bg-amber-400/15"
                  : "text-teal-300 bg-teal-400/15"
              )}
            >
              {icon}
              <span className="truncate">{processedName}</span>
            </div>
          </div>
        );
      },
      size: 110,
    }),

    // Category column
    columnHelper.accessor("category", {
      header: () => (
        <div className="flex items-center gap-1">
          <FolderOpen className="h-3 w-3" />
          Category
        </div>
      ),
      cell: ({ getValue, row }) => {
        const transaction = row.original;
        const categoryName = getValue();
        const category = allCategoriesRef.current!.find((cat) => cat.name === categoryName);
        const isEditingCategory = editingCategoryForTransaction === transaction.id;

        if (isEditingCategory) {
          return (
            <InlineCategoryDropdown
              transactionId={transaction.id}
              currentCategory={categoryName || ""}
              transactionDirection={transaction.direction}
              onCancel={() => {
                setEditingCategoryForTransaction(null);
                const currentRowIndex = allTransactionsRef.current!.findIndex((t) => t.id === transaction.id);
                setFocusedRowIndex(currentRowIndex);
                setFocusedColumnId("category");
                setIsKeyboardNavigationMode(true);
              }}
              onSuccess={() => {
                setEditingCategoryForTransaction(null);
                const currentRowIndex = allTransactionsRef.current!.findIndex((t) => t.id === transaction.id);
                setFocusedRowIndex(currentRowIndex);
                setFocusedColumnId("category");
                setIsKeyboardNavigationMode(true);
              }}
              onTabNext={() => {
                setEditingCategoryForTransaction(null);

                const currentRowIndex = allTransactionsRef.current!.findIndex((t) => t.id === transaction.id);
                const nextColumn = getNextEditableColumn("category", "right");

                if (nextColumn === editableColumns[0]) {
                  const nextRowIndex = Math.min(currentRowIndex + 1, allTransactionsRef.current!.length - 1);
                  const nextTransaction = allTransactionsRef.current![nextRowIndex];
                  if (nextTransaction) {
                    setFocusedRowIndex(nextRowIndex);
                    setFocusedColumnId(nextColumn);
                    if (nextColumn === "description") {
                      setEditingRow(nextTransaction.id);
                      setEditingField("description");
                    } else if (nextColumn === "category") {
                      setEditingCategoryForTransaction(nextTransaction.id);
                    } else if (nextColumn === "tags") {
                      setEditingTagsForTransaction(nextTransaction.id);
                    }
                  }
                } else {
                  setFocusedRowIndex(currentRowIndex);
                  setFocusedColumnId(nextColumn);
                  if (nextColumn === "description") {
                    setEditingRow(transaction.id);
                    setEditingField("description");
                  } else if (nextColumn === "category") {
                    setEditingCategoryForTransaction(transaction.id);
                  } else if (nextColumn === "tags") {
                    setEditingTagsForTransaction(transaction.id);
                  }
                }
                setIsKeyboardNavigationMode(true);
              }}
              onTabPrevious={() => {
                setEditingCategoryForTransaction(null);

                const currentRowIndex = allTransactionsRef.current!.findIndex((t) => t.id === transaction.id);
                const prevColumn = getNextEditableColumn("category", "left");

                if (prevColumn === editableColumns[editableColumns.length - 1]) {
                  const prevRowIndex = Math.max(currentRowIndex - 1, 0);
                  const prevTransaction = allTransactionsRef.current![prevRowIndex];
                  if (prevTransaction) {
                    setFocusedRowIndex(prevRowIndex);
                    setFocusedColumnId(prevColumn);
                    if (prevColumn === "description") {
                      setEditingRow(prevTransaction.id);
                      setEditingField("description");
                    } else if (prevColumn === "category") {
                      setEditingCategoryForTransaction(prevTransaction.id);
                    } else if (prevColumn === "tags") {
                      setEditingTagsForTransaction(prevTransaction.id);
                    }
                  }
                } else {
                  setFocusedRowIndex(currentRowIndex);
                  setFocusedColumnId(prevColumn);
                  if (prevColumn === "description") {
                    setEditingRow(transaction.id);
                    setEditingField("description");
                  } else if (prevColumn === "category") {
                    setEditingCategoryForTransaction(transaction.id);
                  } else if (prevColumn === "tags") {
                    setEditingTagsForTransaction(transaction.id);
                  }
                }
                setIsKeyboardNavigationMode(true);
              }}
            />
          );
        }

        return (
          <div
            className="cursor-pointer hover:bg-muted/50 p-2 rounded whitespace-nowrap"
            onClick={(e) => {
              e.stopPropagation();
              setEditingCategoryForTransaction(transaction.id);
            }}
            title="Click to edit category"
          >
            {category ? (
              <div
                className="font-semibold text-sm inline-flex items-center px-2.5 py-0.5 rounded-md max-w-[120px] overflow-hidden"
                style={{
                  backgroundColor: category.color ? `${category.color}20` : undefined,
                  color: category.color || undefined,
                }}
              >
                <span className="truncate">{category.name}</span>
              </div>
            ) : categoryName ? (
              <span
                className="text-xs text-muted-foreground italic"
                title={`${categoryName} (deleted)`}
              >
                {categoryName} (deleted)
              </span>
            ) : (
              <span className="text-xs text-muted-foreground hover:text-foreground">
                Click to add category
              </span>
            )}
            {row.original.subcategory && (
              <div className="text-xs text-muted-foreground mt-1 truncate max-w-[120px]">
                {row.original.subcategory}
              </div>
            )}
          </div>
        );
      },
      size: 110,
    }),

    // Tags column
    columnHelper.accessor("tags", {
      header: () => (
        <div className="flex items-center gap-1">
          <TagIcon className="h-3 w-3" />
          Tags
        </div>
      ),
      cell: ({ getValue, row }) => {
        const tagNames = getValue();
        const transaction = row.original;
        const tagObjects = convertStringTagsToObjects(tagNames || [], allTagsRef.current!);
        const isEditingTags = editingTagsForTransaction === transaction.id;

        if (isEditingTags) {
          return (
            <InlineTagDropdown
              transactionId={transaction.id}
              currentTags={tagNames || []}
              onCancel={() => {
                setEditingTagsForTransaction(null);
                const currentRowIndex = allTransactionsRef.current!.findIndex((t) => t.id === transaction.id);
                setFocusedRowIndex(currentRowIndex);
                setFocusedColumnId("tags");
                setIsKeyboardNavigationMode(true);
              }}
              onSuccess={() => {
                setEditingTagsForTransaction(null);
                const currentRowIndex = allTransactionsRef.current!.findIndex((t) => t.id === transaction.id);
                setFocusedRowIndex(currentRowIndex);
                setFocusedColumnId("tags");
                setIsKeyboardNavigationMode(true);
              }}
              onTabNext={() => {
                setEditingTagsForTransaction(null);

                const currentRowIndex = allTransactionsRef.current!.findIndex((t) => t.id === transaction.id);
                const nextColumn = getNextEditableColumn("tags", "right");

                if (nextColumn === editableColumns[0]) {
                  const nextRowIndex = Math.min(currentRowIndex + 1, allTransactionsRef.current!.length - 1);
                  const nextTransaction = allTransactionsRef.current![nextRowIndex];
                  if (nextTransaction) {
                    setFocusedRowIndex(nextRowIndex);
                    setFocusedColumnId(nextColumn);
                    if (nextColumn === "description") {
                      setEditingRow(nextTransaction.id);
                      setEditingField("description");
                    } else if (nextColumn === "category") {
                      setEditingCategoryForTransaction(nextTransaction.id);
                    } else if (nextColumn === "tags") {
                      setEditingTagsForTransaction(nextTransaction.id);
                    }
                  }
                } else {
                  setFocusedRowIndex(currentRowIndex);
                  setFocusedColumnId(nextColumn);
                  if (nextColumn === "description") {
                    setEditingRow(transaction.id);
                    setEditingField("description");
                  } else if (nextColumn === "category") {
                    setEditingCategoryForTransaction(transaction.id);
                  } else if (nextColumn === "tags") {
                    setEditingTagsForTransaction(transaction.id);
                  }
                }
                setIsKeyboardNavigationMode(true);
              }}
              onTabPrevious={() => {
                setEditingTagsForTransaction(null);

                const currentRowIndex = allTransactionsRef.current!.findIndex((t) => t.id === transaction.id);
                const prevColumn = getNextEditableColumn("tags", "left");

                if (prevColumn === editableColumns[editableColumns.length - 1]) {
                  const prevRowIndex = Math.max(currentRowIndex - 1, 0);
                  const prevTransaction = allTransactionsRef.current![prevRowIndex];
                  if (prevTransaction) {
                    setFocusedRowIndex(prevRowIndex);
                    setFocusedColumnId(prevColumn);
                    if (prevColumn === "description") {
                      setEditingRow(prevTransaction.id);
                      setEditingField("description");
                    } else if (prevColumn === "category") {
                      setEditingCategoryForTransaction(prevTransaction.id);
                    } else if (prevColumn === "tags") {
                      setEditingTagsForTransaction(prevTransaction.id);
                    }
                  }
                } else {
                  setFocusedRowIndex(currentRowIndex);
                  setFocusedColumnId(prevColumn);
                  if (prevColumn === "description") {
                    setEditingRow(transaction.id);
                    setEditingField("description");
                  } else if (prevColumn === "category") {
                    setEditingCategoryForTransaction(transaction.id);
                  } else if (prevColumn === "tags") {
                    setEditingTagsForTransaction(transaction.id);
                  }
                }
                setIsKeyboardNavigationMode(true);
              }}
            />
          );
        }

        const visibleTags = tagObjects.slice(0, 2);
        const overflowCount = tagObjects.length - 2;

        return (
          <div
            className="cursor-pointer hover:bg-muted/50 p-1 rounded"
            onClick={(e) => {
              e.stopPropagation();
              setEditingTagsForTransaction(transaction.id);
            }}
            title="Click to edit tags"
          >
            {tagObjects && tagObjects.length > 0 ? (
              <div className="flex items-center gap-1 flex-nowrap min-w-0">
                {visibleTags.map((tag) => (
                  <TagPill
                    key={tag.id}
                    tag={tag}
                    variant="compact"
                    className="text-xs flex-shrink-0"
                    onRemove={async (tagId) => {
                      try {
                        const remainingTags = tagObjects.filter((t) => t.id !== tagId);
                        await onUpdateTransactionRef.current!({
                          id: transaction.id,
                          updates: {
                            tags: remainingTags.map((t) => t.name),
                          },
                        });
                        toast.success("Tag removed successfully");
                      } catch {
                        toast.error("Failed to remove tag");
                      }
                    }}
                  />
                ))}
                {overflowCount > 0 && (
                  <span
                    title={tagObjects.slice(2).map((t) => t.name).join(", ")}
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border cursor-default shrink-0"
                  >
                    +{overflowCount}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground/40 hover:text-muted-foreground/70 whitespace-nowrap transition-colors">
                Click to add tags
              </span>
            )}
          </div>
        );
      },
      size: 120,
    }),

    // Actions column
    columnHelper.display({
      id: "actions",
      header: () => null,
      cell: ({ row }) => {
        const transaction = row.original;

        const transactionGroup = transaction.transaction_group_id
          ? allTransactionsUnfilteredRef.current!.filter(
              (t) => t.transaction_group_id === transaction.transaction_group_id
            )
          : [];

        const isSplitGroup =
          !!transaction.transaction_group_id &&
          (transaction.is_split === true || transactionGroup.some((t) => t.is_split === true));

        const handleSplitClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          e.preventDefault();

          if (isSplitGroup) {
            setDrawerVariant(null);
            setDrawerTransaction(transaction);
            setIsDrawerOpen(true);
          }
        };

        const handleSplitGroupHover = () => {
          if (isSplitGroup) {
            handleHighlightTransactions(transactionGroup.map((t) => t.id));
          }
        };

        const isFocusedRow =
          isKeyboardNavigationMode &&
          focusedRowIndex === allTransactionsRef.current!.findIndex((t) => t.id === transaction.id);
        const isFocusedActionsColumn = isFocusedRow && focusedColumnId === "actions";

        // Derive active states for each badge
        const isSharedActive = !!transaction.is_shared;
        const isGroupActive = !!(transaction.transaction_group_id && !transaction.is_split);
        const isSplitActive = isSplitGroup;
        const isEmailActive = !!(transaction.related_mails && transaction.related_mails.length > 0);
        const isFlagActive = transaction.is_flagged === true;
        const hasAnyActive = isSharedActive || isGroupActive || isSplitActive || isEmailActive || isFlagActive;

        // Collapsible wrapper: active badges always shown; inactive buttons collapse to w-0
        // and expand on row hover (group-hover). Keyboard focus also forces expansion.
        // overflow-hidden is only applied to inactive wrappers (needed for width collapse);
        // active wrappers are overflow-visible so the circular box-shadow glow isn't clipped.
        const btnWrap = (isActive: boolean, focusVisible: boolean) =>
          cn(
            "transition-[width,opacity] duration-[180ms] ease-[cubic-bezier(0.4,0,0.2,1)]",
            "flex items-center justify-center flex-shrink-0",
            isActive || focusVisible
              ? "w-[30px] opacity-100"
              : "overflow-hidden w-0 opacity-0 group-hover:w-[30px] group-hover:opacity-100"
          );

        return (
          <div className="relative flex justify-center items-center">
            {/* ••• idle hint — only when no active badges, fades out on hover */}
            {!hasAnyActive && (
              <div className="absolute flex items-center gap-[3px] pointer-events-none transition-opacity duration-150 group-hover:opacity-0">
                <span className="w-[4px] h-[4px] rounded-full bg-white/[0.12]" />
                <span className="w-[4px] h-[4px] rounded-full bg-white/[0.12]" />
                <span className="w-[4px] h-[4px] rounded-full bg-white/[0.12]" />
              </div>
            )}

            {/* 1. Shared */}
            <div className={btnWrap(isSharedActive, isFocusedActionsColumn && focusedActionButton === 0)}>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0 rounded-full transition-all duration-200",
                  isSharedActive
                    ? "bg-violet-400/15 text-violet-300 hover:bg-violet-400/20 shadow-[0_0_12px_rgba(196,181,253,0.2)]"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  isFocusedActionsColumn && focusedActionButton === 0 && "ring-2 ring-blue-500 ring-inset"
                )}
                onClick={() => {
                  setSelectedTransactionForSplit(transaction);
                  setIsSplitEditorOpen(true);
                }}
                title={isSharedActive ? "Shared expense (mark as personal)" : "Share expenses"}
              >
                <Users className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* 2. Group expense */}
            <div className={btnWrap(isGroupActive, isFocusedActionsColumn && focusedActionButton === 1)}>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0 rounded-full transition-all duration-200",
                  isGroupActive
                    ? "bg-teal-400/15 text-teal-300 hover:bg-teal-400/20 shadow-[0_0_12px_rgba(45,212,191,0.2)]"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  isFocusedActionsColumn && focusedActionButton === 1 && "ring-2 ring-blue-500 ring-inset"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (transaction.transaction_group_id && !transaction.is_split) {
                    setDrawerTransaction(transaction);
                    setDrawerVariant("groupedExpense");
                    setIsDrawerOpen(true);
                  } else {
                    setGroupExpenseFromTransaction(transaction);
                    setIsGroupExpenseSearchModalOpen(true);
                  }
                }}
                title={transaction.transaction_group_id ? "View group in sidebar" : "Group this transaction with others (search to add more)"}
              >
                <Layers className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* 3. Split */}
            <div className={btnWrap(isSplitActive, isFocusedActionsColumn && focusedActionButton === 2)}>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0 rounded-full transition-all duration-200",
                  isSplitActive
                    ? "bg-sky-400/15 text-sky-300 hover:bg-sky-400/20 shadow-[0_0_12px_rgba(125,211,252,0.2)]"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  isFocusedActionsColumn && focusedActionButton === 2 && "ring-2 ring-blue-500 ring-inset"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isSplitGroup) {
                    handleSplitClick(e);
                  } else {
                    setSelectedTransactionForSplitting(transaction);
                    setIsSplitTransactionModalOpen(true);
                  }
                }}
                onMouseEnter={handleSplitGroupHover}
                onMouseLeave={handleClearHighlight}
                title={isSplitActive ? "View split transaction group" : "Split transaction"}
              >
                <Split className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* 4. Email links */}
            <div className={btnWrap(isEmailActive, isFocusedActionsColumn && focusedActionButton === 3)}>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0 rounded-full transition-all duration-200",
                  isEmailActive
                    ? "bg-amber-400/15 text-amber-300 hover:bg-amber-400/20 shadow-[0_0_12px_rgba(251,191,36,0.2)]"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  isFocusedActionsColumn && focusedActionButton === 3 && "ring-2 ring-blue-500 ring-inset"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setEmailLinksTransaction(transaction);
                  setIsEmailLinksDrawerOpen(true);
                }}
                title={isEmailActive ? `${transaction.related_mails!.length} email(s) linked` : "Link emails"}
              >
                <Mail className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* 5. Flag */}
            <div className={btnWrap(isFlagActive, isFocusedActionsColumn && focusedActionButton === 4)}>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0 rounded-full transition-all duration-200",
                  isFlagActive
                    ? "bg-[#F44D4D]/15 text-[#F44D4D] hover:bg-[#F44D4D]/20 shadow-[0_0_12px_rgba(244,77,77,0.2)]"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  isFocusedActionsColumn && focusedActionButton === 4 && "ring-2 ring-blue-500 ring-inset"
                )}
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    await onUpdateTransactionRef.current!({
                      id: transaction.id,
                      updates: { is_flagged: !isFlagActive },
                    });
                    toast.success(isFlagActive ? "Warning removed" : "Transaction marked for review");
                  } catch {
                    toast.error("Failed to update warning status");
                  }
                }}
                title={isFlagActive ? "Remove warning" : "Mark for review"}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* 6. Delete — always inactive (hover-reveal only) */}
            <div className={btnWrap(false, isFocusedActionsColumn && focusedActionButton === 5)}>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 w-7 p-0 rounded-full transition-all duration-200 bg-muted/40 text-muted-foreground hover:bg-[#F44D4D]/15 hover:text-[#F44D4D]",
                  isFocusedActionsColumn && focusedActionButton === 5 && "ring-2 ring-blue-500 ring-inset"
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  setTransactionToDelete(transaction);
                  setIsDeleteConfirmationOpen(true);
                }}
                title="Delete transaction"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

          </div>
        );
      },
      size: 160,
    }),
  ] as ColumnDef<Transaction>[];
}
