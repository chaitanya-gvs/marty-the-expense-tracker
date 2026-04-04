"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTransactionKeyboardNav } from "@/hooks/use-transaction-keyboard-nav";
import { buildTransactionColumns } from "./transaction-columns";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  SortingState,
  ColumnSizingState,
  Updater,
} from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
// Using native HTML table elements for better sticky header support
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useInfiniteTransactions, useUpdateTransactionSplit, useClearTransactionSplit, useUpdateTransaction, useBulkDeleteTransactions, useDeleteTransaction } from "@/hooks/use-transactions";
import { useTags } from "@/hooks/use-tags";
import { useCategories } from "@/hooks/use-categories";
import { Transaction, TransactionFilters, TransactionSort, SplitBreakdown } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  ArrowUpDown,
  CheckSquare,
  Edit,
  Layers,
  Keyboard,
  Loader2,
  ScanSearch,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { TransactionEditModal } from "./transaction-edit-modal";
import { SharedExpenseEditor } from "./shared-expense-editor";
import { BulkEditModal } from "./bulk-edit-modal";
import { RelatedTransactionsDrawer } from "./related-transactions-drawer";
import { SplitTransactionModal } from "./split-transaction-modal";
import { GroupTransferModal } from "./group-transfer-modal";
import { GroupExpenseModal } from "./group-expense-modal";
import { GroupExpenseSearchModal } from "./group-expense-search-modal";
import { EmailLinksDrawer } from "./email-links-drawer";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { PdfViewer } from "./pdf-viewer";
import { formatCurrency } from "@/lib/format-utils";

// Wrapper component to fetch missing related transactions
function RelatedTransactionsDrawerWithFetch({
  transaction,
  allTransactions,
  allTransactionsUnfiltered,
  isOpen,
  onClose,
  onUnlink,
  onUnlinkChild,
  onUngroup,
  onRemoveFromGroup,
  drawerVariant = null,
}: {
  transaction: Transaction;
  allTransactions: Transaction[];
  allTransactionsUnfiltered: Transaction[];
  isOpen: boolean;
  onClose: () => void;
  onUnlink: () => void;
  onUnlinkChild?: (childId: string) => void;
  onUngroup: () => void;
  onRemoveFromGroup: (transactionId: string) => void;
  drawerVariant?: "split" | "transfer" | "groupedExpense" | null;
}) {
  const [fetchedGroup, setFetchedGroup] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Find group in loaded data
  const groupInLoaded = transaction.transaction_group_id
    ? allTransactionsUnfiltered.filter(t => t.transaction_group_id === transaction.transaction_group_id)
    : [];

  // Fetch missing related transactions when drawer opens
  useEffect(() => {
    if (!isOpen) {
      setFetchedGroup([]);
      return;
    }

    const fetchRelatedTransactions = async () => {
      setIsLoading(true);
      try {
        const relatedResponse = await apiClient.getRelatedTransactions(transaction.id);
        if (relatedResponse.data?.group && relatedResponse.data.group.length > 0) {
          setFetchedGroup(relatedResponse.data.group);
        } else if (transaction.transaction_group_id) {
          try {
            const groupResponse = await apiClient.getGroupTransactions(transaction.id);
            if (groupResponse.data && groupResponse.data.length > 0) {
              setFetchedGroup(groupResponse.data);
            }
          } catch {
            // Silently ignore group fetch failures
          }
        }
      } catch {
        // Silently ignore related transaction fetch failures
      } finally {
        setIsLoading(false);
      }
    };

    fetchRelatedTransactions();
  }, [isOpen, transaction.id, transaction.transaction_group_id, groupInLoaded.length]);

  // Prefer fetched group (from API) so split parent and all members are included; fall back to loaded only when fetch hasn't returned yet
  const transferGroup = fetchedGroup.length > 0 ? fetchedGroup : groupInLoaded;

  return (
    <RelatedTransactionsDrawer
      transaction={transaction}
      parentTransaction={undefined}
      childTransactions={[]}
      transferGroup={transferGroup}
      isOpen={isOpen}
      onClose={onClose}
      onUnlink={onUnlink}
      onUnlinkChild={onUnlinkChild}
      onUngroup={onUngroup}
      onRemoveFromGroup={onRemoveFromGroup}
      modeOverride={drawerVariant ?? undefined}
    />
  );
}

interface TransactionsTableProps {
  filters?: TransactionFilters;
  sort?: TransactionSort;
}

export function TransactionsTable({ filters, sort }: TransactionsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<keyof Transaction | null>(null);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedTransactionForSplit, setSelectedTransactionForSplit] = useState<Transaction | null>(null);
  const [isSplitEditorOpen, setIsSplitEditorOpen] = useState(false);
  const [selectedTransactionForSplitting, setSelectedTransactionForSplitting] = useState<Transaction | null>(null);
  const [isSplitTransactionModalOpen, setIsSplitTransactionModalOpen] = useState(false);
  const [editingTagsForTransaction, setEditingTagsForTransaction] = useState<string | null>(null);
  const [editingCategoryForTransaction, setEditingCategoryForTransaction] = useState<string | null>(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<string>>(new Set());
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [highlightedTransactionIds, setHighlightedTransactionIds] = useState<Set<string>>(new Set());
  const [drawerTransaction, setDrawerTransaction] = useState<Transaction | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerVariant, setDrawerVariant] = useState<"split" | "transfer" | "groupedExpense" | null>(null);
  const [groupTransferModalTransaction, setGroupTransferModalTransaction] = useState<Transaction | null>(null);
  const [isGroupExpenseModalOpen, setIsGroupExpenseModalOpen] = useState(false);
  const [groupExpensePreselectedTransactions, setGroupExpensePreselectedTransactions] = useState<Transaction[] | null>(null);
  const [isGroupExpenseSearchModalOpen, setIsGroupExpenseSearchModalOpen] = useState(false);
  const [groupExpenseFromTransaction, setGroupExpenseFromTransaction] = useState<Transaction | null>(null);
  const [expandedGroupedExpenses, setExpandedGroupedExpenses] = useState<Set<string>>(new Set());
  const [groupMembers, setGroupMembers] = useState<Map<string, Transaction[]>>(new Map());
  const [emailLinksTransaction, setEmailLinksTransaction] = useState<Transaction | null>(null);
  const [isEmailLinksDrawerOpen, setIsEmailLinksDrawerOpen] = useState(false);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [pdfViewerTransactionId, setPdfViewerTransactionId] = useState<string | null>(null);
  const [isPdfViewerOpen, setIsPdfViewerOpen] = useState(false);

  // Quick View Drawer State
  const [detailsTransaction, setDetailsTransaction] = useState<Transaction | null>(null);
  const [isDetailsDrawerOpen, setIsDetailsDrawerOpen] = useState(false);

  // Column resizing state (persists description width in localStorage)
  const COLUMN_SIZING_KEY = "transactions-table-column-sizing";
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => {
    if (typeof window === "undefined") return { description: 420 };
    try {
      const stored = localStorage.getItem(COLUMN_SIZING_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ColumnSizingState;
        if (typeof parsed.description === "number" && parsed.description >= 180 && parsed.description <= 900) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return { description: 420 };
  });

  const handleColumnSizingChange = useCallback(
    (updater: Updater<ColumnSizingState>) => {
      setColumnSizing((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        try {
          localStorage.setItem(COLUMN_SIZING_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    []
  );

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();
  const updateTransactionSplit = useUpdateTransactionSplit();
  const clearTransactionSplit = useClearTransactionSplit();
  const updateTransaction = useUpdateTransaction();
  const bulkDeleteTransactions = useBulkDeleteTransactions();
  const deleteTransaction = useDeleteTransaction();
  const { data: allTags = [] } = useTags();
  const { data: allCategories = [] } = useCategories();

  const handleRowClick = useCallback((transaction: Transaction) => {
    setDetailsTransaction(transaction);
    setIsDetailsDrawerOpen(true);
  }, []);

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteTransactions(filters, sort);


  // Flatten all transactions from all pages (unfiltered - includes parent transactions)
  const allTransactionsUnfiltered = useMemo(() => {
    return data?.pages.flatMap(page => page.data) || [];
  }, [data]);

  // Pre-compute set of split-parent IDs in O(n) instead of O(n²) filter.
  // Transfer groups should NOT be excluded (they all have is_split=false but no split children).
  const splitParentIds = useMemo(() => {
    // Collect all group IDs that have at least one split child (is_split=true)
    const groupIdsWithSplitChildren = new Set<string>();
    for (const t of allTransactionsUnfiltered) {
      if (t.transaction_group_id && t.is_split === true) {
        groupIdsWithSplitChildren.add(t.transaction_group_id);
      }
    }
    // Collect IDs of the non-split parent rows in those groups
    const ids = new Set<string>();
    for (const t of allTransactionsUnfiltered) {
      if (t.transaction_group_id && t.is_split === false && groupIdsWithSplitChildren.has(t.transaction_group_id)) {
        ids.add(t.id);
      }
    }
    return ids;
  }, [allTransactionsUnfiltered]);

  // Filter out parent transactions in split groups - we only want to show the split parts
  const allTransactions = useMemo(() => {
    if (splitParentIds.size === 0) return allTransactionsUnfiltered;
    return allTransactionsUnfiltered.filter(t => !splitParentIds.has(t.id));
  }, [allTransactionsUnfiltered, splitParentIds]);

  // Stable refs so column callbacks always read latest values without
  // triggering a columns useMemo rebuild on every data update.
  const allTransactionsRef = useRef(allTransactions);
  const allTransactionsUnfilteredRef = useRef(allTransactionsUnfiltered);
  const allTagsRef = useRef(allTags);
  const allCategoriesRef = useRef(allCategories);
  const onUpdateTransactionRef = useRef((params: { id: string; updates: Partial<Transaction> }) =>
    updateTransaction.mutateAsync(params)
  );

  useEffect(() => { allTransactionsRef.current = allTransactions; }, [allTransactions]);
  useEffect(() => { allTransactionsUnfilteredRef.current = allTransactionsUnfiltered; }, [allTransactionsUnfiltered]);
  useEffect(() => { allTagsRef.current = allTags; }, [allTags]);
  useEffect(() => { allCategoriesRef.current = allCategories; }, [allCategories]);
  useEffect(() => {
    onUpdateTransactionRef.current = (params: { id: string; updates: Partial<Transaction> }) =>
      updateTransaction.mutateAsync(params);
  }, [updateTransaction]);

  // Selection helpers
  const selectedTransactions = useMemo(() => {
    return allTransactions.filter(t => selectedTransactionIds.has(t.id));
  }, [allTransactions, selectedTransactionIds]);

  const isAllSelected = allTransactions.length > 0 && selectedTransactionIds.size === allTransactions.length;
  const isIndeterminate = selectedTransactionIds.size > 0 && selectedTransactionIds.size < allTransactions.length;

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedTransactionIds(new Set());
    } else {
      setSelectedTransactionIds(new Set(allTransactions.map(t => t.id)));
    }
  };

  const handleSelectTransaction = (transactionId: string) => {
    setSelectedTransactionIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(transactionId)) {
        newSet.delete(transactionId);
      } else {
        newSet.add(transactionId);
      }
      return newSet;
    });
  };

  // Enhanced bulk action logic
  const canBulkGroupExpense = useMemo(() => {
    // Can group any number of transactions (1 or more)
    if (selectedTransactions.length < 1) return false;
    // Disable only if one of the selected rows is the collapsed grouped-expense row (the summary).
    // Individuals in a group (including orphaned groups with no collapsed row) are allowed — backend will assign a new group.
    const hasCollapsedGroupRow = selectedTransactions.some(t =>
      t.transaction_group_id && !t.is_split && t.is_grouped_expense
    );
    return !hasCollapsedGroupRow;
  }, [selectedTransactions]);

  // Selection summary for enhanced toolbar
  const selectionSummary = useMemo(() => {
    const debits = selectedTransactions.filter(t => t.direction === "debit");
    const credits = selectedTransactions.filter(t => t.direction === "credit");
    const totalAmount = selectedTransactions.reduce((sum, t) => sum + t.amount, 0);

    return {
      total: selectedTransactions.length,
      debits: debits.length,
      credits: credits.length,
      totalAmount,
    };
  }, [selectedTransactions]);

  // Highlight management functions
  const handleHighlightTransactions = useCallback((transactionIds: string[]) => {
    setHighlightedTransactionIds(new Set(transactionIds));
  }, []);

  const handleClearHighlight = useCallback(() => {
    setHighlightedTransactionIds(new Set());
  }, []);

  const handleBulkGroupExpense = () => {
    if (!canBulkGroupExpense) return;
    setIsGroupExpenseModalOpen(true);
  };

  const handleGroupExpenseSuccess = () => {
    setSelectedTransactionIds(new Set());
    setIsGroupExpenseModalOpen(false);
    setGroupExpensePreselectedTransactions(null);
    queryClient.invalidateQueries({ queryKey: ["transactions"] });
    queryClient.invalidateQueries({ queryKey: ["transactions-infinite"] });
  };

  const toggleGroupExpense = async (transaction: Transaction) => {
    const groupId = transaction.transaction_group_id;
    if (!groupId) return;

    const isExpanded = expandedGroupedExpenses.has(groupId);

    if (isExpanded) {
      // Collapse
      const newExpanded = new Set(expandedGroupedExpenses);
      newExpanded.delete(groupId);
      setExpandedGroupedExpenses(newExpanded);
    } else {
      // Expand - fetch members if not already fetched
      if (!groupMembers.has(groupId)) {
        try {
          const response = await apiClient.getGroupTransactions(transaction.id);
          const members = response.data || [];
          setGroupMembers(new Map(groupMembers).set(groupId, members));
        } catch {
          toast.error("Failed to fetch group members");
          return;
        }
      }
      
      const newExpanded = new Set(expandedGroupedExpenses);
      newExpanded.add(groupId);
      setExpandedGroupedExpenses(newExpanded);
    }
  };

  const handleUngroupExpense = async (transaction: Transaction) => {
    if (!transaction.transaction_group_id) return;

    try {
      await apiClient.ungroupExpense(transaction.transaction_group_id);
      toast.success("Expense ungrouped successfully");
      
      // Clear from expanded state and group members cache
      const newExpanded = new Set(expandedGroupedExpenses);
      newExpanded.delete(transaction.transaction_group_id);
      setExpandedGroupedExpenses(newExpanded);
      
      const newGroupMembers = new Map(groupMembers);
      newGroupMembers.delete(transaction.transaction_group_id);
      setGroupMembers(newGroupMembers);
      
      // Clear infinite query cache so the deleted collapsed row cannot stay in a cached page
      queryClient.removeQueries({ queryKey: ["transactions-infinite"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    } catch {
      toast.error("Failed to ungroup expense");
    }
  };

  const handleBulkSwapDirection = async () => {
    try {
      const updatePromises = selectedTransactions.map(t =>
        apiClient.updateTransaction(t.id, {
          direction: t.direction === "debit" ? "credit" : "debit",
        })
      );

      await Promise.all(updatePromises);

      toast.success(`Swapped direction for ${selectedTransactions.length} transactions`, {
        action: {
          label: "Undo",
          onClick: async () => {
            // Swap back
            const undoPromises = selectedTransactions.map(t =>
              apiClient.updateTransaction(t.id, {
                direction: t.direction === "debit" ? "credit" : "debit",
              })
            );
            await Promise.all(undoPromises);
          },
        },
      });
      setSelectedTransactionIds(new Set());
    } catch {
      toast.error("Failed to swap directions");
    }
  };

  // Infinite scroll effect
  const fetchMoreOnBottomReached = useCallback(
    (containerRefElement?: HTMLDivElement | null) => {
      if (containerRefElement) {
        const { scrollHeight, scrollTop, clientHeight } = containerRefElement;
        if (scrollHeight - scrollTop - clientHeight < 400 && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  // Scroll synchronization between header and body
  const handleHeaderScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (bodyScrollRef.current) {
      bodyScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  }, []);

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
    fetchMoreOnBottomReached(e.currentTarget);
  }, [fetchMoreOnBottomReached]);

  useEffect(() => {
    fetchMoreOnBottomReached(tableContainerRef.current);
  }, [fetchMoreOnBottomReached]);

  // Handle action button clicks from keyboard navigation
  const handleActionButtonClick = useCallback((transaction: Transaction, buttonIndex: number) => {
    switch (buttonIndex) {
      case 0: // Shared button
        setSelectedTransactionForSplit(transaction);
        setIsSplitEditorOpen(true);
        break;
      case 1: // Group expense - sidebar if already grouped, else modal
        if (transaction.transaction_group_id && !transaction.is_split) {
          setDrawerTransaction(transaction);
          setDrawerVariant("groupedExpense");
          setIsDrawerOpen(true);
        } else {
          setGroupExpenseFromTransaction(transaction);
          setIsGroupExpenseSearchModalOpen(true);
        }
        break;
      case 2: // Split button
        const isSplitGroup = !!transaction.transaction_group_id && transaction.is_split;
        if (isSplitGroup) {
          setDrawerTransaction(transaction);
          setIsDrawerOpen(true);
        } else {
          setSelectedTransactionForSplitting(transaction);
          setIsSplitTransactionModalOpen(true);
        }
        break;
      case 3: // Links button
        setEmailLinksTransaction(transaction);
        setIsEmailLinksDrawerOpen(true);
        break;
      case 4: // Flag button
        updateTransaction.mutate({
          id: transaction.id,
          updates: {
            is_flagged: !(transaction.is_flagged === true),
          },
        });
        break;
      case 5: { // Toggle direction button
        const nextDirection = transaction.direction === "debit" ? "credit" : "debit";
        void updateTransaction
          .mutateAsync({
            id: transaction.id,
            updates: {
              direction: nextDirection,
            },
          })
          .then(() => {
            toast.success(`Marked as ${nextDirection === "credit" ? "credit (money in)" : "debit (money out)"}`);
          })
          .catch(() => {
            toast.error("Failed to toggle transaction direction");
          });
        break;
      }
      case 6: // Delete button
        setTransactionToDelete(transaction);
        setIsDeleteConfirmationOpen(true);
        break;
      case 7: // PDF viewer button (when visible)
        setPdfViewerTransactionId(transaction.id);
        setIsPdfViewerOpen(true);
        break;
    }
  }, [allTransactions, updateTransaction]);

  // Keyboard navigation (extracted into hook; initialized after handleActionButtonClick)
  const {
    focusedRowIndex,
    focusedColumnId,
    isKeyboardNavigationMode,
    focusedActionButton,
    setFocusedRowIndex,
    setFocusedColumnId,
    setIsKeyboardNavigationMode,
    editableColumns,
    getNextEditableColumn,
  } = useTransactionKeyboardNav(allTransactions, {
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
  });

  const columns = useMemo(
    () =>
      buildTransactionColumns({
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
      }),
    [
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
      expandedGroupedExpenses,
      editableColumns,
      getNextEditableColumn,
      handleSelectAll,
      handleSelectTransaction,
      handleHighlightTransactions,
      handleClearHighlight,
      toggleGroupExpense,
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
    ]
  );

  const table = useReactTable({
    data: allTransactions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnSizingChange: handleColumnSizingChange,
    state: {
      sorting,
      columnSizing,
    },
    columnResizeMode: "onChange",
    enableColumnResizing: true,
  });

  const { rows } = table.getRowModel();

  // Pre-compute daily debit totals: O(n) one pass, used O(1) per date header
  const dailyDebitTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.original.direction !== "debit") continue;
      const date = (r.original.date ?? "").split("T")[0];
      if (!date) continue;
      const amount = r.original.is_shared && r.original.split_share_amount
        ? r.original.split_share_amount
        : r.original.amount ?? 0;
      map.set(date, (map.get(date) ?? 0) + amount);
    }
    return map;
  }, [rows]);

  const parentRef = React.useRef<HTMLDivElement>(null);

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border border-border p-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          <span className="ml-2 text-muted-foreground text-sm">Loading transactions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card rounded-lg border border-border p-8">
        <div className="text-center text-destructive text-sm">
          Error loading transactions: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border">
      <div className="p-4 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {isKeyboardNavigationMode && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs flex items-center gap-1">
                  <Keyboard className="h-3 w-3" />
                  Keyboard Navigation Active
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Tab: Save & move right • Enter: Edit • Arrow keys: Navigate • Esc: Exit
                </span>
              </div>
            )}
            {!isMultiSelectMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsMultiSelectMode(true);
                  if (allTransactions.length > 0) {
                    setFocusedRowIndex(0);
                  }
                }}
                className="flex items-center gap-2"
              >
                <CheckSquare className="h-4 w-4" />
                Multi-Select
              </Button>
            )}
            <AnimatePresence>
            {isMultiSelectMode && (
              <motion.div
                className="flex items-center gap-2"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              >
                <Badge variant="secondary" className="text-sm">
                  {selectionSummary.total} selected
                  {selectionSummary.total > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({selectionSummary.debits} debits, {selectionSummary.credits} credits)
                    </span>
                  )}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsBulkEditModalOpen(true)}
                  className="flex items-center gap-2"
                  disabled={selectedTransactionIds.size === 0}
                >
                  <Edit className="h-4 w-4" />
                  Bulk Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkGroupExpense}
                  className="flex items-center gap-2"
                  disabled={!canBulkGroupExpense}
                  title={canBulkGroupExpense ? "Group as expense" : "Cannot group: selection includes the summary row of a grouped expense"}
                >
                  <Layers className="h-4 w-4" />
                  Group expense
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkSwapDirection}
                  className="flex items-center gap-2"
                  disabled={selectedTransactionIds.size === 0}
                  title="Swap debit ↔ credit for selected transactions"
                >
                  <ArrowUpDown className="h-4 w-4" />
                  Swap direction
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setIsDeleteConfirmationOpen(true)}
                  className="flex items-center gap-2"
                  disabled={selectedTransactionIds.size === 0}
                  title="Delete selected transactions"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedTransactionIds(new Set());
                    setIsMultiSelectMode(false);
                  }}
                >
                  Done
                </Button>
              </motion.div>
            )}
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {isFetchingNextPage && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary"></div>
                Loading more...
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {data?.pages?.[0]?.pagination?.total ? (
                <>
                  <div className="w-16 h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary/50 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, (allTransactions.length / data.pages[0].pagination.total) * 100)}%` }}
                    />
                  </div>
                  <span className="tabular-nums font-mono">{allTransactions.length} / {data.pages[0].pagination.total}</span>
                </>
              ) : (
                <span className="tabular-nums font-mono">{allTransactions.length}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {isMultiSelectMode && selectedTransactionIds.size > 0 && (
        <div className="flex items-center justify-between px-3 py-2 bg-primary/8 border-x border-t border-primary/25 rounded-t-lg text-xs font-medium text-primary -mb-px mx-0 shadow-[0_-2px_0_0_var(--color-primary)]">
          <span>{selectedTransactionIds.size} transaction{selectedTransactionIds.size !== 1 ? "s" : ""} selected</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-primary hover:bg-primary/10" onClick={() => setIsBulkEditModalOpen(true)}>Edit</Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-destructive hover:bg-destructive/10" onClick={() => setIsDeleteConfirmationOpen(true)}>Delete</Button>
            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground" onClick={() => setSelectedTransactionIds(new Set())}>Clear</Button>
          </div>
        </div>
      )}
      <div className="w-full" style={{ height: "70vh", display: "flex", flexDirection: "column" }}>
        {/* Sticky Header */}
        <div
          ref={headerScrollRef}
          className="flex-shrink-0 w-full overflow-x-auto bg-card border-b border-border z-50 scrollbar-none"
          onScroll={handleHeaderScroll}
        >
          <table
            className="w-full table-fixed"
            style={{ minWidth: table.getCenterTotalSize() }}
          >
            <colgroup>
              {table.getHeaderGroups()[0].headers.map((header) => (
                <col
                  key={header.id}
                  style={{
                    width: header.getSize(),
                    ...(header.column.columnDef.minSize != null && { minWidth: header.column.columnDef.minSize }),
                    ...(header.column.columnDef.maxSize != null && { maxWidth: header.column.columnDef.maxSize }),
                  }}
                />
              ))}
            </colgroup>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b transition-colors">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="relative px-3 py-2 text-left font-medium text-xs text-muted-foreground bg-muted/70 dark:bg-muted/60 h-10 align-middle uppercase tracking-wide whitespace-nowrap border-b-2 border-border [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
                      style={{
                        width: header.getSize(),
                        ...(header.column.columnDef.minSize != null && { minWidth: header.column.columnDef.minSize }),
                        ...(header.column.columnDef.maxSize != null && { maxWidth: header.column.columnDef.maxSize }),
                      }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-primary active:bg-primary rounded transition-colors"
                          style={{ touchAction: "none" }}
                          title="Drag to resize column"
                        />
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
          </table>
        </div>

        {/* Scrollable Body */}
        <div
          ref={(node) => {
            bodyScrollRef.current = node;
            parentRef.current = node;
            tableContainerRef.current = node;
          }}
          className="flex-1 overflow-auto relative w-full scrollbar-none"
          onScroll={handleBodyScroll}
        >
          <table
            className="w-full table-fixed"
            style={{ minWidth: table.getCenterTotalSize() }}
          >
            <colgroup>
              {table.getHeaderGroups()[0].headers.map((header) => (
                <col
                  key={header.id}
                  style={{
                    width: header.getSize(),
                    ...(header.column.columnDef.minSize != null && { minWidth: header.column.columnDef.minSize }),
                    ...(header.column.columnDef.maxSize != null && { maxWidth: header.column.columnDef.maxSize }),
                  }}
                />
              ))}
            </colgroup>
            <tbody className="[&_tr:last-child]:border-0">
              {(() => {
                // Date-grouped rendering
                let lastDate = "";
                const colCount = table.getHeaderGroups()[0].headers.length;
                return rows.map((row, rowIndex) => {
                  const isFocusedRow = isKeyboardNavigationMode && focusedRowIndex === rowIndex;
                  const isGroupedExpense = row.original.is_grouped_expense;
                  const isExpanded = row.original.transaction_group_id
                    ? expandedGroupedExpenses.has(row.original.transaction_group_id)
                    : false;
                  const members = row.original.transaction_group_id
                    ? groupMembers.get(row.original.transaction_group_id) || []
                    : [];

                  const rowDate = row.original.date ? row.original.date.split("T")[0] : "";
                  const showDateHeader = rowDate !== lastDate;
                  if (showDateHeader) lastDate = rowDate;

                  // Daily debit total — O(1) lookup into pre-computed map
                  const dailyTotal = showDateHeader ? (dailyDebitTotals.get(rowDate) ?? 0) : 0;

                  const dateLabel = rowDate
                    ? new Date(rowDate + "T12:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                    : "";

                  return (
                    <React.Fragment key={row.id}>
                      {showDateHeader && (
                        <tr className="border-t border-b border-border bg-muted/30 dark:bg-muted/20">
                          <td colSpan={colCount} className="px-4 py-1.5">
                            <div className="flex items-center gap-3">
                              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{dateLabel}</span>
                              <div className="flex-1 h-px bg-border" />
                              {dailyTotal > 0 && (
                                <span className="text-xs font-mono text-muted-foreground/70 tabular-nums">· {formatCurrency(dailyTotal)}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    <tr
                      className={cn(
                        "group border-b border-border/50 transition-colors duration-100 h-12",
                        selectedTransactionIds.has(row.original.id)
                          ? "bg-primary/[0.10] hover:bg-primary/[0.14] border-l-2 border-l-primary/60"
                          : "hover:bg-muted/50 dark:hover:bg-muted/40 cursor-default",
                        editingRow === row.original.id && "bg-primary/5",
                        highlightedTransactionIds.has(row.original.id) && "bg-primary/5 border-l-2 border-l-primary",
                        isFocusedRow && "bg-primary/10 border-l-2 border-l-primary"
                      )}
                      style={{
                        animation: "fadeSlideIn 0.25s ease-out both",
                        animationDelay: `${Math.min(rowIndex, 20) * 25}ms`,
                      }}
                    // onClick={() => handleRowClick(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => {
                        const isFocusedCell = isFocusedRow && focusedColumnId === cell.column.id;
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "px-3 py-2 text-sm align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
                              editingTagsForTransaction === row.original.id && cell.column.id === "tags" && "relative",
                              editingCategoryForTransaction === row.original.id && cell.column.id === "category" && "relative",
                              isFocusedCell && "ring-2 ring-primary ring-inset bg-primary/5"
                            )}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext()
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    
                    {/* Render individual transactions for expanded grouped expenses */}
                    {isGroupedExpense && isExpanded && members.length > 0 && members.map((member) => (
                      <tr
                        key={`member-${member.id}`}
                        className="bg-muted/10 border-l-2 border-l-chart-4 hover:bg-muted/30 border-b border-border/50 transition-colors duration-100 cursor-default"
                      >
                        {isMultiSelectMode && <td className="px-3 py-2"></td>}
                        <td className="px-3 py-2 text-xs text-muted-foreground/60">
                          {format(new Date(member.date), "dd MMM yy")}
                        </td>
                        <td className="px-3 py-2 pl-8 min-w-0">
                          <div className="text-sm truncate">{member.description}</div>
                          {member.notes && (
                            <div className="text-xs text-muted-foreground truncate">{member.notes}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs font-mono",
                              member.direction === "debit"
                                ? "border-[#F44D4D]/40 text-[#F44D4D]"
                                : "border-emerald-400/40 text-emerald-300"
                            )}
                          >
                            {formatCurrency(member.amount)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{member.account.split(" ").slice(0, -2).join(" ")}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{member.category || "Uncategorized"}</td>
                        <td colSpan={colCount - (isMultiSelectMode ? 6 : 5)} className="px-3 py-2"></td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              });
              })()}
              {isFetchingNextPage && (
                <tr>
                  <td colSpan={table.getAllColumns().length} className="py-5 text-center border-b-0">
                    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/50">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading more transactions…
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {!isLoading && allTransactions.length === 0 && (
            <motion.div
              className="flex flex-col items-center justify-center py-20 text-center gap-3"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.15 }}
            >
              <div className="w-14 h-14 rounded-2xl bg-muted/60 border border-border flex items-center justify-center">
                <ScanSearch className="h-7 w-7 text-muted-foreground/30" />
              </div>
              <p className="text-sm font-medium text-foreground/70">No transactions found</p>
              <p className="text-xs text-muted-foreground/60 max-w-[280px] leading-relaxed">
                Try adjusting your filters or date range to see results.
              </p>
            </motion.div>
          )}
        </div>
      </div>

      {!hasNextPage && allTransactions.length > 0 && (
        <div className="p-3 border-t border-border flex items-center justify-center gap-3">
          <div className="w-20 h-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary/50 rounded-full transition-all duration-500"
              style={{ width: `${data?.pages[0]?.pagination?.total ? Math.min(100, (allTransactions.length / data.pages[0].pagination.total) * 100) : 100}%` }}
            />
          </div>
          <span className="text-xs tabular-nums font-mono text-muted-foreground">
            {data?.pages[0]?.pagination?.total
              ? `${allTransactions.length} / ${data.pages[0].pagination.total}`
              : `${allTransactions.length}`}
          </span>
        </div>
      )}

      {/* Transaction Edit Modal */}
      {selectedTransactionId && (
        <TransactionEditModal
          transactionId={selectedTransactionId}
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setSelectedTransactionId(null);
          }}
        />
      )}

      {/* Split Editor Modal */}
      {selectedTransactionForSplit && (
        <SharedExpenseEditor
          transaction={selectedTransactionForSplit}
          isOpen={isSplitEditorOpen}
          isLoading={updateTransactionSplit.isPending || clearTransactionSplit.isPending}
          onClose={() => {
            setIsSplitEditorOpen(false);
            setSelectedTransactionForSplit(null);
          }}
          onSave={async (splitBreakdown: SplitBreakdown, myShareAmount: number) => {
            try {
              await updateTransactionSplit.mutateAsync({
                id: selectedTransactionForSplit.id,
                splitBreakdown,
                myShareAmount
              });
              setIsSplitEditorOpen(false);
              setSelectedTransactionForSplit(null);
            } catch {
              toast.error("Failed to save split breakdown");
            }
          }}
          onClearSplit={async () => {
            try {
              await clearTransactionSplit.mutateAsync(selectedTransactionForSplit.id);
              setIsSplitEditorOpen(false);
              setSelectedTransactionForSplit(null);
            } catch {
              toast.error("Failed to clear split");
            }
          }}
        />
      )}

      {/* Bulk Edit Modal */}
      {selectedTransactions.length > 0 && (
        <BulkEditModal
          selectedTransactions={selectedTransactions}
          isOpen={isBulkEditModalOpen}
          onClose={() => {
            setIsBulkEditModalOpen(false);
            setSelectedTransactionIds(new Set());
          }}
        />
      )}

      {/* Split Transaction Modal */}
      {selectedTransactionForSplitting && (
        <SplitTransactionModal
          transaction={selectedTransactionForSplitting}
          isOpen={isSplitTransactionModalOpen}
          onClose={() => {
            setIsSplitTransactionModalOpen(false);
            setSelectedTransactionForSplitting(null);
          }}
        />
      )}

      {/* Group Transfer Modal */}
      {groupTransferModalTransaction && (
        <GroupTransferModal
          transaction={groupTransferModalTransaction}
          transferGroup={
            groupTransferModalTransaction.transaction_group_id
              ? allTransactions.filter(t =>
                t.transaction_group_id === groupTransferModalTransaction.transaction_group_id &&
                !t.is_split
              )
              : []
          }
          allTransactions={allTransactions}
          isOpen={!!groupTransferModalTransaction}
          onClose={() => setGroupTransferModalTransaction(null)}
          onGroup={async (transactionIds) => {
            try {
              await apiClient.groupTransfer(transactionIds);
              toast.success(`Grouped ${transactionIds.length} transactions as a transfer`);
              setGroupTransferModalTransaction(null);
            } catch {
              toast.error("Failed to group transfer");
            }
          }}
          onUngroup={async () => {
            try {
              await updateTransaction.mutateAsync({
                id: groupTransferModalTransaction.id,
                updates: { transaction_group_id: undefined },
              });
              toast.success("Transfer ungrouped successfully");
              setGroupTransferModalTransaction(null);
            } catch {
              toast.error("Failed to ungroup transfer");
            }
          }}
          onAddToGroup={async (transactionIds) => {
            try {
              const targetGroupId = groupTransferModalTransaction.transaction_group_id;
              const updatePromises = transactionIds.map(id =>
                updateTransaction.mutateAsync({
                  id,
                  updates: { transaction_group_id: targetGroupId },
                })
              );
              await Promise.all(updatePromises);
              toast.success(`Added ${transactionIds.length} transactions to transfer group`);
              setGroupTransferModalTransaction(null);
            } catch {
              toast.error("Failed to add to transfer group");
            }
          }}
          onRemoveFromGroup={async (transactionId) => {
            try {
              await updateTransaction.mutateAsync({
                id: transactionId,
                updates: { transaction_group_id: undefined },
              });
              toast.success("Transaction removed from transfer group");
            } catch {
              toast.error("Failed to remove from transfer group");
            }
          }}
        />
      )}

      {/* Group Expense Modal */}
      <GroupExpenseSearchModal
        isOpen={isGroupExpenseSearchModalOpen}
        onClose={() => {
          setIsGroupExpenseSearchModalOpen(false);
          setGroupExpenseFromTransaction(null);
        }}
        onSelectTransactions={(txs) => {
          setGroupExpensePreselectedTransactions(txs);
          setIsGroupExpenseSearchModalOpen(false);
          setGroupExpenseFromTransaction(null);
          setIsGroupExpenseModalOpen(true);
        }}
        initialTransaction={groupExpenseFromTransaction}
        existingGroupMembers={
          groupExpenseFromTransaction?.transaction_group_id
            ? (groupMembers.get(groupExpenseFromTransaction.transaction_group_id) ?? undefined)
            : undefined
        }
        onUngroup={async (transactionGroupId) => {
          await handleUngroupExpense({ transaction_group_id: transactionGroupId } as Transaction);
          setIsGroupExpenseSearchModalOpen(false);
          setGroupExpenseFromTransaction(null);
        }}
      />
      <GroupExpenseModal
        selectedTransactions={groupExpensePreselectedTransactions ?? selectedTransactions}
        isOpen={isGroupExpenseModalOpen}
        onClose={() => {
          setIsGroupExpenseModalOpen(false);
          setGroupExpensePreselectedTransactions(null);
        }}
        onGroupSuccess={handleGroupExpenseSuccess}
      />

      {/* Related Transactions Drawer - Rendered at table level to persist across re-renders */}
      {drawerTransaction && (
        <RelatedTransactionsDrawerWithFetch
          transaction={drawerTransaction}
          allTransactions={allTransactions}
          allTransactionsUnfiltered={allTransactionsUnfiltered}
          isOpen={isDrawerOpen}
          onClose={() => {
            setIsDrawerOpen(false);
            setDrawerTransaction(null);
            setDrawerVariant(null);
          }}
          onUnlink={async () => {
            // No-op: parent-child refund linking removed; use ungroup for groups
            setIsDrawerOpen(false);
            setDrawerTransaction(null);
          }}
          onUnlinkChild={async () => {
            // No-op: parent-child refund linking removed
          }}
          onUngroup={async () => {
            try {
              if (drawerVariant === "groupedExpense" && drawerTransaction?.transaction_group_id) {
                await handleUngroupExpense(drawerTransaction);
                setIsDrawerOpen(false);
                setDrawerTransaction(null);
                setDrawerVariant(null);
                return;
              }
              const transferGroupId = drawerTransaction.transaction_group_id;
              if (transferGroupId) {
                const groupTransactions = allTransactions.filter(t => t.transaction_group_id === transferGroupId);
                await Promise.all(
                  groupTransactions.map(t =>
                    updateTransaction.mutateAsync({
                      id: t.id,
                      updates: { transaction_group_id: null },
                    })
                  )
                );
                toast.success("Transfer group removed successfully");
                await new Promise(resolve => setTimeout(resolve, 300));
              }
              setIsDrawerOpen(false);
              setDrawerTransaction(null);
              setDrawerVariant(null);
            } catch {
              toast.error(drawerVariant === "groupedExpense" ? "Failed to ungroup expense" : "Failed to ungroup transfer");
            }
          }}
          onRemoveFromGroup={async (transactionId) => {
            try {
              await updateTransaction.mutateAsync({
                id: transactionId,
                updates: { transaction_group_id: null },
              });
              toast.success("Transaction removed from group");
            } catch {
              toast.error("Failed to remove transaction from group");
            }
          }}
          drawerVariant={drawerVariant}
        />
      )}

      {/* Email Links Drawer */}
      {emailLinksTransaction && (
        <EmailLinksDrawer
          transaction={emailLinksTransaction}
          isOpen={isEmailLinksDrawerOpen}
          onClose={() => {
            setIsEmailLinksDrawerOpen(false);
            setEmailLinksTransaction(null);
          }}
          onTransactionUpdate={(updatedTransaction) => {
            // Update the transaction in the cache
            // The hook will automatically refetch and update the UI
            updateTransaction.mutate({
              id: updatedTransaction.id,
              updates: {
                related_mails: updatedTransaction.related_mails,
              },
            });
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <PdfViewer
        transactionId={pdfViewerTransactionId || ""}
        open={isPdfViewerOpen}
        onOpenChange={(open) => {
          setIsPdfViewerOpen(open);
          if (!open) {
            setPdfViewerTransactionId(null);
          }
        }}
      />

      {/* <TransactionDetailsDrawer
        transaction={detailsTransaction}
        isOpen={isDetailsDrawerOpen}
        onClose={() => setIsDetailsDrawerOpen(false)}
      /> */}

      <DeleteConfirmationDialog
        isOpen={isDeleteConfirmationOpen}
        onClose={() => {
          setIsDeleteConfirmationOpen(false);
          setTransactionToDelete(null);
        }}
        onConfirm={async () => {
          try {
            if (transactionToDelete) {
              // Single transaction deletion
              await deleteTransaction.mutateAsync(transactionToDelete.id);
              toast.success("Transaction deleted successfully");
            } else {
              // Bulk deletion
              const transactionIds = Array.from(selectedTransactionIds);
              await bulkDeleteTransactions.mutateAsync(transactionIds);
              toast.success(`Successfully deleted ${transactionIds.length} transaction${transactionIds.length > 1 ? 's' : ''}`);
              setSelectedTransactionIds(new Set());
              setIsMultiSelectMode(false);
            }
            setIsDeleteConfirmationOpen(false);
            setTransactionToDelete(null);
          } catch {
            toast.error("Failed to delete transaction(s)");
          }
        }}
        transactions={transactionToDelete ? [transactionToDelete] : allTransactions.filter(t => selectedTransactionIds.has(t.id))}
        isLoading={deleteTransaction.isPending || bulkDeleteTransactions.isPending}
      />
    </div>
  );
}
