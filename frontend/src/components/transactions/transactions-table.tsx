"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  createColumnHelper,
  SortingState,
  ColumnDef,
  Row,
  ColumnSizingState,
} from "@tanstack/react-table";
import { useQueryClient } from "@tanstack/react-query";
// Using native HTML table elements for better sticky header support
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useInfiniteTransactions, useUpdateTransactionSplit, useClearTransactionSplit, useUpdateTransaction, useBulkDeleteTransactions, useDeleteTransaction, useTransaction } from "@/hooks/use-transactions";
import { useTags } from "@/hooks/use-tags";
import { useCategories } from "@/hooks/use-categories";
import { Transaction, TransactionFilters, TransactionSort, SplitBreakdown, Tag, Category } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Tag as TagIcon,
  Users,
  Edit3,
  CreditCard,
  Wallet,
  Calendar,
  ShoppingCart,
  Building2,
  MoreVertical,
  Link2,
  CheckSquare,
  Square,
  Edit,
  Split,
  RefreshCcw,
  AlertCircle,
  Trash2,
  FileText,
  Layers,
  ChevronDown
} from "lucide-react";
import { format } from "date-fns";
import { TransactionEditModal } from "./transaction-edit-modal";
import { TransactionInlineEdit } from "./transaction-inline-edit";
import { SplitEditor } from "./split-editor";
import { TagPill } from "./tag-pill";
import { InlineTagDropdown } from "./inline-tag-dropdown";
import { InlineCategoryDropdown } from "./inline-category-dropdown";
import { BulkEditModal } from "./bulk-edit-modal";
import { RelatedTransactionsDrawer } from "./related-transactions-drawer";
import { TransactionDetailsDrawer } from "./transaction-details-drawer";
import { SplitTransactionModal } from "./split-transaction-modal";
import { GroupTransferModal } from "./group-transfer-modal";
import { GroupExpenseModal } from "./group-expense-modal";
import { GroupExpenseSearchModal } from "./group-expense-search-modal";
import { EmailLinksDrawer } from "./email-links-drawer";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";
import { PdfViewer } from "./pdf-viewer";
import { formatCurrency, formatDate } from "@/lib/format-utils";

const columnHelper = createColumnHelper<Transaction>();

// Helper function to process account names and get icons
const processAccountInfo = (accountName: string) => {
  // Handle Splitwise accounts specially
  if (accountName.toLowerCase().includes('splitwise')) {
    return {
      processedName: 'Splitwise',
      icon: <Users className="h-3 w-3 mr-1" />,
      isCreditCard: false,
      isSplitwise: true
    };
  }

  // Remove last 2 words (e.g., "Savings Account", "Credit Card")
  const words = accountName.split(' ');
  const processedName = words.slice(0, -2).join(' ');

  // Determine if it's a credit card or savings account
  const isCreditCard = accountName.toLowerCase().includes('credit');
  const icon = isCreditCard ? <CreditCard className="h-3 w-3 mr-1" /> : <Wallet className="h-3 w-3 mr-1" />;

  return { processedName, icon, isCreditCard, isSplitwise: false };
};

// Helper function to convert string tags to Tag objects
const convertStringTagsToObjects = (tagNames: string[], allTags: Tag[]): Tag[] => {
  return tagNames
    .map(tagName => allTags.find(tag => tag.name === tagName))
    .filter(Boolean) as Tag[];
};

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
          } catch (groupError) {
            console.error("Failed to fetch group transactions:", groupError);
          }
        }
      } catch (error) {
        console.error("Failed to fetch related transactions:", error);
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
    (updater: (old: ColumnSizingState) => ColumnSizingState) => {
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

  // Keyboard navigation state
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);
  const [focusedColumnId, setFocusedColumnId] = useState<string | null>(null);
  const [isKeyboardNavigationMode, setIsKeyboardNavigationMode] = useState(false);
  const [focusedActionButton, setFocusedActionButton] = useState<number>(-1);

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

  // Filter out parent transactions in split groups (is_split=false but has transaction_group_id with split children)
  // These are the original transactions that were split - we only want to show the split parts
  // Transfer groups should NOT be excluded (they all have is_split=false but no split children)
  const allTransactions = useMemo(() => {
    return allTransactionsUnfiltered.filter(t => {
      // Only exclude if this is a split parent (has transaction_group_id, is_split=false, AND has split children)
      if (t.transaction_group_id && t.is_split === false) {
        // Check if there are any split children in the same group
        const hasSplitChildren = allTransactionsUnfiltered.some(
          other => other.transaction_group_id === t.transaction_group_id &&
            other.id !== t.id &&
            other.is_split === true
        );
        // Only exclude if it's a split parent (has split children)
        if (hasSplitChildren) {
          return false;
        }
      }
      return true;
    });
  }, [allTransactionsUnfiltered]);

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
        } catch (error) {
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
      
      // Refresh transactions (infinite query is what the table uses)
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-infinite"] });
    } catch (error) {
      toast.error("Failed to ungroup expense");
      console.error("Ungroup error:", error);
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
    } catch (error) {
      toast.error("Failed to swap directions");
      console.error("Bulk swap direction error:", error);
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
          .catch((error) => {
            console.error("Failed to toggle direction:", error);
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

  // Keyboard navigation helpers
  const editableColumns = useMemo(() => {
    const columns = ['description', 'category', 'tags', 'actions'];
    if (isMultiSelectMode) {
      return ['select', ...columns];
    }
    return columns;
  }, [isMultiSelectMode]);

  const getNextEditableColumn = useCallback((currentColumnId: string | null, direction: 'left' | 'right' = 'right') => {
    if (!currentColumnId) return editableColumns[0];

    const currentIndex = editableColumns.indexOf(currentColumnId);
    if (currentIndex === -1) return editableColumns[0];

    if (direction === 'right') {
      return editableColumns[currentIndex + 1] || editableColumns[0];
    } else {
      return editableColumns[currentIndex - 1] || editableColumns[editableColumns.length - 1];
    }
  }, [editableColumns]);

  const handleKeyboardNavigation = useCallback((e: KeyboardEvent) => {
    const { key } = e;
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

    // Handle Cmd/Ctrl + Delete for bulk deletion
    if ((key === 'Delete' || key === 'Backspace') && cmdOrCtrl && isMultiSelectMode && selectedTransactionIds.size > 0) {
      e.preventDefault();
      setIsDeleteConfirmationOpen(true);
      setTransactionToDelete(null);
      return;
    }

    // Handle Cmd/Ctrl + Arrow keys for multi-select navigation
    if (cmdOrCtrl && isMultiSelectMode && (key === 'ArrowUp' || key === 'ArrowDown')) {
      e.preventDefault();
      // Initialize focusedRowIndex if it's not set
      let currentIndex = focusedRowIndex;
      if (currentIndex < 0 && allTransactions.length > 0) {
        currentIndex = 0;
        setFocusedRowIndex(0);
      }

      if (key === 'ArrowUp' && currentIndex > 0) {
        const newIndex = currentIndex - 1;
        setFocusedRowIndex(newIndex);
        const transaction = allTransactions[newIndex];
        if (transaction) {
          handleSelectTransaction(transaction.id);
        }
      } else if (key === 'ArrowDown' && currentIndex < allTransactions.length - 1) {
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
    if (key === 'Tab' && (editingRow || editingField || editingTagsForTransaction || editingCategoryForTransaction)) {
      // Let the edit components handle Tab navigation
      return;
    }

    // Only handle other keys when not in edit mode
    if (editingRow || editingField || editingTagsForTransaction || editingCategoryForTransaction) {
      return;
    }

    switch (key) {
      case 'Tab':
        e.preventDefault();
        isUserNavigating.current = false; // Reset navigation flag for Tab
        if (focusedRowIndex >= 0 && focusedColumnId) {
          const nextColumn = getNextEditableColumn(focusedColumnId, e.shiftKey ? 'left' : 'right');
          setFocusedColumnId(nextColumn);

          // If we wrapped around, move to next/previous row
          if (nextColumn === editableColumns[0] && !e.shiftKey) {
            const nextRowIndex = Math.min(focusedRowIndex + 1, allTransactions.length - 1);
            setFocusedRowIndex(nextRowIndex);
          } else if (nextColumn === editableColumns[editableColumns.length - 1] && e.shiftKey) {
            const prevRowIndex = Math.max(focusedRowIndex - 1, 0);
            setFocusedRowIndex(prevRowIndex);
          }
        } else {
          // Start navigation from first row, first column
          setFocusedRowIndex(0);
          setFocusedColumnId(editableColumns[0]);
          setIsKeyboardNavigationMode(true);
        }
        break;

      case 'Enter':
        e.preventDefault();
        isUserNavigating.current = false; // Reset navigation flag
        if (focusedRowIndex >= 0 && focusedColumnId && focusedColumnId !== 'select') {
          const transaction = allTransactions[focusedRowIndex];
          if (transaction) {
            if (focusedColumnId === 'tags') {
              setEditingTagsForTransaction(transaction.id);
            } else if (focusedColumnId === 'category') {
              setEditingCategoryForTransaction(transaction.id);
            } else if (focusedColumnId === 'actions') {
              if (focusedActionButton >= 0) {
                // Trigger the focused action button
                handleActionButtonClick(transaction, focusedActionButton);
              } else {
                // Focus first action button when entering actions column
                setFocusedActionButton(0);
              }
            } else {
              setEditingRow(transaction.id);
              setEditingField(focusedColumnId as keyof Transaction);
            }
            setIsKeyboardNavigationMode(false);
          }
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (focusedRowIndex > 0) {
          isUserNavigating.current = true;
          setFocusedRowIndex(focusedRowIndex - 1);
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (focusedRowIndex < allTransactions.length - 1) {
          isUserNavigating.current = true;
          setFocusedRowIndex(focusedRowIndex + 1);
        }
        break;

      case 'ArrowLeft':
        e.preventDefault();
        if (focusedColumnId === 'actions' && focusedActionButton > 0) {
          // Navigate between action buttons
          setFocusedActionButton(focusedActionButton - 1);
        } else if (focusedColumnId) {
          setFocusedColumnId(getNextEditableColumn(focusedColumnId, 'left'));
          setFocusedActionButton(-1);
        }
        break;

      case 'ArrowRight':
        e.preventDefault();
        if (focusedColumnId === 'actions' && focusedActionButton < 7) { // 8 action buttons (0-7); PDF is conditional
          // Navigate between action buttons
          setFocusedActionButton(focusedActionButton + 1);
        } else if (focusedColumnId) {
          setFocusedColumnId(getNextEditableColumn(focusedColumnId, 'right'));
          setFocusedActionButton(-1);
        }
        break;

      case 'Escape':
        e.preventDefault();
        if (focusedActionButton >= 0) {
          // Exit action button focus, stay in actions column
          setFocusedActionButton(-1);
        } else {
          // Exit keyboard navigation completely
          setIsKeyboardNavigationMode(false);
          setFocusedRowIndex(-1);
          setFocusedColumnId(null);
        }
        break;
    }
  }, [
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
    handleSelectTransaction
  ]);

  // Auto-scroll to keep focused cell in view
  const scrollToFocusedCell = useCallback(() => {
    if (focusedRowIndex >= 0 && bodyScrollRef.current) {
      const tableBody = bodyScrollRef.current;
      const table = tableBody.querySelector('table');
      if (!table) return;

      const rows = table.querySelectorAll('tbody tr');
      const focusedRow = rows[focusedRowIndex] as HTMLElement;

      if (!focusedRow) return;

      // Use scrollIntoView for more reliable scrolling
      focusedRow.scrollIntoView({
        behavior: 'smooth',
        block: 'center', // Center the row in the viewport
        inline: 'nearest'
      });
    }
  }, [focusedRowIndex]);

  // Track previous row index to only scroll when row actually changes
  const prevFocusedRowIndex = useRef<number>(-1);
  const isUserNavigating = useRef<boolean>(false);

  // Auto-scroll when focused row changes (only for up/down navigation)
  useEffect(() => {
    if (isKeyboardNavigationMode && focusedRowIndex >= 0 && focusedRowIndex !== prevFocusedRowIndex.current && isUserNavigating.current) {
      // Only scroll if the row index actually changed AND user is actively navigating
      prevFocusedRowIndex.current = focusedRowIndex;
      // Small delay to ensure DOM is updated
      setTimeout(scrollToFocusedCell, 10);
    } else if (!isKeyboardNavigationMode) {
      // Reset when exiting keyboard navigation mode
      prevFocusedRowIndex.current = -1;
      isUserNavigating.current = false;
    }
  }, [focusedRowIndex, isKeyboardNavigationMode, scrollToFocusedCell]);

  // Add keyboard event listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if we're not in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        return;
      }
      handleKeyboardNavigation(e);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyboardNavigation]);

  const columns = useMemo(
    () => {
      const baseColumns = [];

      // Only add selection column when in multi-select mode
      if (isMultiSelectMode) {
        baseColumns.push(
          columnHelper.display({
            id: "select",
            header: ({ table }) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                className="h-8 w-8 p-0"
              >
                {isAllSelected ? (
                  <CheckSquare className="h-4 w-4 text-blue-600" />
                ) : isIndeterminate ? (
                  <div className="h-4 w-4 border-2 border-blue-400 rounded bg-blue-100" />
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
                  <CheckSquare className="h-4 w-4 text-blue-600" />
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
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
              className="h-8 px-2 gap-1 text-sm font-medium"
            >
              <Calendar className="h-4 w-4" />
              Date
              {column.getIsSorted() === "asc" ? (
                <ArrowUp className="ml-1 h-3 w-3 text-blue-600" />
              ) : column.getIsSorted() === "desc" ? (
                <ArrowDown className="ml-1 h-3 w-3 text-blue-600" />
              ) : (
                <ArrowUpDown className="ml-1 h-3 w-3" />
              )}
            </Button>
          ),
          cell: ({ getValue }) => {
            return (
              <div className="text-left whitespace-nowrap">
                {formatDate(getValue())}
              </div>
            );
          },
          size: 100,
        }),

        // Description column (resizable)
        columnHelper.accessor("description", {
          header: () => (
            <div className="flex items-center gap-1 text-sm font-medium">
              <ShoppingCart className="h-4 w-4" />
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
                    // Maintain keyboard navigation state after canceling description edit
                    const currentRowIndex = allTransactions.findIndex(t => t.id === row.original.id);
                    setFocusedRowIndex(currentRowIndex);
                    setFocusedColumnId("description");
                    setIsKeyboardNavigationMode(true);
                  }}
                  onSuccess={() => {
                    setEditingRow(null);
                    setEditingField(null);
                    // Maintain keyboard navigation state after description edit
                    const currentRowIndex = allTransactions.findIndex(t => t.id === row.original.id);
                    setFocusedRowIndex(currentRowIndex);
                    setFocusedColumnId("description");
                    setIsKeyboardNavigationMode(true);
                  }}
                  onTabNext={() => {
                    // Close current edit
                    setEditingRow(null);
                    setEditingField(null);

                    // Move to next editable cell
                    const currentRowIndex = allTransactions.findIndex(t => t.id === row.original.id);
                    const nextColumn = getNextEditableColumn("description", "right");

                    if (nextColumn === editableColumns[0]) {
                      // Wrapped to next row
                      const nextRowIndex = Math.min(currentRowIndex + 1, allTransactions.length - 1);
                      const nextTransaction = allTransactions[nextRowIndex];
                      if (nextTransaction) {
                        setFocusedRowIndex(nextRowIndex);
                        setFocusedColumnId(nextColumn);
                        // Open edit for next cell
                        if (nextColumn === 'description') {
                          setEditingRow(nextTransaction.id);
                          setEditingField('description');
                        } else if (nextColumn === 'category') {
                          setEditingCategoryForTransaction(nextTransaction.id);
                        } else if (nextColumn === 'tags') {
                          setEditingTagsForTransaction(nextTransaction.id);
                        }
                      }
                    } else {
                      setFocusedRowIndex(currentRowIndex);
                      setFocusedColumnId(nextColumn);
                      // Open edit for next cell in same row
                      if (nextColumn === 'description') {
                        setEditingRow(row.original.id);
                        setEditingField('description');
                      } else if (nextColumn === 'category') {
                        setEditingCategoryForTransaction(row.original.id);
                      } else if (nextColumn === 'tags') {
                        setEditingTagsForTransaction(row.original.id);
                      }
                    }
                    setIsKeyboardNavigationMode(true);
                  }}
                  onTabPrevious={() => {
                    // Close current edit
                    setEditingRow(null);
                    setEditingField(null);

                    // Move to previous editable cell
                    const currentRowIndex = allTransactions.findIndex(t => t.id === row.original.id);
                    const prevColumn = getNextEditableColumn("description", "left");

                    if (prevColumn === editableColumns[editableColumns.length - 1]) {
                      // Wrapped to previous row
                      const prevRowIndex = Math.max(currentRowIndex - 1, 0);
                      const prevTransaction = allTransactions[prevRowIndex];
                      if (prevTransaction) {
                        setFocusedRowIndex(prevRowIndex);
                        setFocusedColumnId(prevColumn);
                        // Open edit for previous cell
                        if (prevColumn === 'description') {
                          setEditingRow(prevTransaction.id);
                          setEditingField('description');
                        } else if (prevColumn === 'category') {
                          setEditingCategoryForTransaction(prevTransaction.id);
                        } else if (prevColumn === 'tags') {
                          setEditingTagsForTransaction(prevTransaction.id);
                        }
                      }
                    } else {
                      setFocusedRowIndex(currentRowIndex);
                      setFocusedColumnId(prevColumn);
                      // Open edit for previous cell in same row
                      if (prevColumn === 'description') {
                        setEditingRow(row.original.id);
                        setEditingField('description');
                      } else if (prevColumn === 'category') {
                        setEditingCategoryForTransaction(row.original.id);
                      } else if (prevColumn === 'tags') {
                        setEditingTagsForTransaction(row.original.id);
                      }
                    }
                    setIsKeyboardNavigationMode(true);
                  }}
                />
              );
            }

            const description = getValue();
            const fullText = row.original.notes ? `${description} - ${row.original.notes}` : description;
            const isGroupedExpense = row.original.is_grouped_expense;
            const isExpanded = row.original.transaction_group_id 
              ? expandedGroupedExpenses.has(row.original.transaction_group_id)
              : false;

            return (
              <div
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded"
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
                        className={cn(
                          "h-4 w-4 transition-transform",
                          isExpanded && "rotate-180"
                        )}
                      />
                    </button>
                  )}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-1">
                      <div className="font-medium text-sm truncate" title={fullText}>
                        {description}
                      </div>
                      {isGroupedExpense && (
                        <Layers className="h-3 w-3 text-purple-600 dark:text-purple-400 flex-shrink-0" />
                      )}
                    </div>
                    {row.original.notes && (
                      <div className="text-xs text-gray-500 truncate" title={row.original.notes}>
                        {row.original.notes}
                      </div>
                    )}
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
              className="h-8 px-2 gap-1 text-sm font-medium justify-end w-full"
            >
              <span className="text-lg font-bold">₹</span>
              Amount
              {column.getIsSorted() === "asc" ? (
                <ArrowUp className="ml-1 h-3 w-3 text-blue-600" />
              ) : column.getIsSorted() === "desc" ? (
                <ArrowDown className="ml-1 h-3 w-3 text-blue-600" />
              ) : (
                <ArrowUpDown className="ml-1 h-3 w-3" />
              )}
            </Button>
          ),
          sortingFn: (rowA, rowB) => {
            // Use effective amount (my share) for sorting shared transactions
            const getEffectiveAmount = (row: Row<Transaction>) => {
              const isShared = row.original.is_shared;
              const splitAmount = row.original.split_share_amount;
              return isShared && splitAmount ? splitAmount : row.original.amount;
            };

            const amountA = getEffectiveAmount(rowA);
            const amountB = getEffectiveAmount(rowB);
            return amountA - amountB;
          },
          cell: ({ getValue, row }) => {
            const totalAmount = getValue(); // Original amount
            const splitAmount = row.original.split_share_amount; // User's share (based on net)
            const netAmount = row.original.net_amount; // Net after refunds
            const direction = row.original.direction;
            const isShared = row.original.is_shared;

            // Check if refunds exist (net < total)
            // netAmount will only be defined if refunds exist (backend only sends it when net < original)
            const hasRefunds = netAmount !== undefined && netAmount < totalAmount;

            // Determine primary display amount
            let displayAmount: number;
            if (isShared && splitAmount !== undefined && splitAmount !== null) {
              // For shared transactions, show split_share_amount (even if 0)
              displayAmount = splitAmount;
            } else if (hasRefunds && netAmount !== undefined && netAmount > 0) {
              // For non-shared transactions with partial refunds, show net amount as primary
              displayAmount = netAmount;
            } else {
              // For non-shared transactions (no refunds or full refund where net=0), show original amount
              displayAmount = totalAmount;
            }

            // Show Total if it differs from what we're displaying
            const showTotal = displayAmount !== totalAmount;

            // Show Net ONLY for shared transactions with refunds (between split and total)
            // Conditions: shared, has refunds, splitAmount exists, netAmount exists and > 0, 
            // net differs from both split and total
            const showNet = isShared
              && hasRefunds
              && splitAmount !== undefined
              && splitAmount !== null
              && netAmount !== undefined
              && netAmount > 0
              && netAmount !== splitAmount
              && netAmount !== totalAmount;

            return (
              <div className="flex flex-col items-end whitespace-nowrap">
                <div className={cn(
                  "font-semibold text-sm inline-flex items-center px-3 py-1 rounded-full",
                  direction === "debit"
                    ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                    : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                )}>
                  {direction === "debit" ? "↓" : "↑"} {formatCurrency(displayAmount)}
                </div>
                {showTotal && (
                  <div className="text-xs text-gray-500 mt-1 text-right">
                    Total: {formatCurrency(totalAmount)}
                  </div>
                )}
                {showNet && (
                  <div className="text-xs text-gray-500 mt-0.5 text-right">
                    Net: {formatCurrency(netAmount)}
                  </div>
                )}
              </div>
            );
          },
          size: 120,
        }),

        // Account column (moved after amount)
        columnHelper.accessor("account", {
          header: () => (
            <div className="flex items-center gap-1 text-sm font-medium">
              <Building2 className="h-4 w-4" />
              Account
            </div>
          ),
          cell: ({ getValue }) => {
            const { processedName, icon, isCreditCard, isSplitwise } = processAccountInfo(getValue());
            return (
              <div className="whitespace-nowrap" title={getValue()}>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs font-medium inline-flex items-center max-w-[120px]",
                    isSplitwise
                      ? "border-purple-500 text-purple-700 bg-purple-50 dark:border-purple-400 dark:text-purple-300 dark:bg-purple-900/20"
                      : isCreditCard
                        ? "border-blue-500 text-blue-700 bg-blue-50 dark:border-blue-400 dark:text-blue-300 dark:bg-blue-900/20"
                        : "border-green-500 text-green-700 bg-green-50 dark:border-green-400 dark:text-green-300 dark:bg-green-900/20"
                  )}
                >
                  {icon}
                  <span className="truncate">{processedName}</span>
                </Badge>
              </div>
            );
          },
          size: 110,
        }),

        // Category column (moved after amount)
        columnHelper.accessor("category", {
          header: () => (
            <div className="flex items-center gap-1 text-sm font-medium">
              <TagIcon className="h-4 w-4" />
              Category
            </div>
          ),
          cell: ({ getValue, row }) => {
            const transaction = row.original;
            const categoryName = getValue();
            const category = allCategories.find(cat => cat.name === categoryName);
            const isEditingCategory = editingCategoryForTransaction === transaction.id;

            if (isEditingCategory) {
              return (
                <InlineCategoryDropdown
                  transactionId={transaction.id}
                  currentCategory={categoryName || ""}
                  transactionDirection={transaction.direction}
                  onCancel={() => {
                    setEditingCategoryForTransaction(null);
                    // Maintain keyboard navigation state after canceling category edit
                    const currentRowIndex = allTransactions.findIndex(t => t.id === transaction.id);
                    setFocusedRowIndex(currentRowIndex);
                    setFocusedColumnId("category");
                    setIsKeyboardNavigationMode(true);
                  }}
                  onSuccess={() => {
                    setEditingCategoryForTransaction(null);
                    // Maintain keyboard navigation state after category selection
                    const currentRowIndex = allTransactions.findIndex(t => t.id === transaction.id);
                    setFocusedRowIndex(currentRowIndex);
                    setFocusedColumnId("category");
                    setIsKeyboardNavigationMode(true);
                  }}
                  onTabNext={() => {
                    // Close current edit
                    setEditingCategoryForTransaction(null);

                    // Move to next editable cell
                    const currentRowIndex = allTransactions.findIndex(t => t.id === transaction.id);
                    const nextColumn = getNextEditableColumn("category", "right");

                    if (nextColumn === editableColumns[0]) {
                      // Wrapped to next row
                      const nextRowIndex = Math.min(currentRowIndex + 1, allTransactions.length - 1);
                      const nextTransaction = allTransactions[nextRowIndex];
                      if (nextTransaction) {
                        setFocusedRowIndex(nextRowIndex);
                        setFocusedColumnId(nextColumn);
                        // Open edit for next cell
                        if (nextColumn === 'description') {
                          setEditingRow(nextTransaction.id);
                          setEditingField('description');
                        } else if (nextColumn === 'category') {
                          setEditingCategoryForTransaction(nextTransaction.id);
                        } else if (nextColumn === 'tags') {
                          setEditingTagsForTransaction(nextTransaction.id);
                        }
                      }
                    } else {
                      setFocusedRowIndex(currentRowIndex);
                      setFocusedColumnId(nextColumn);
                      // Open edit for next cell in same row
                      if (nextColumn === 'description') {
                        setEditingRow(transaction.id);
                        setEditingField('description');
                      } else if (nextColumn === 'category') {
                        setEditingCategoryForTransaction(transaction.id);
                      } else if (nextColumn === 'tags') {
                        setEditingTagsForTransaction(transaction.id);
                      }
                    }
                    setIsKeyboardNavigationMode(true);
                  }}
                  onTabPrevious={() => {
                    // Close current edit
                    setEditingCategoryForTransaction(null);

                    // Move to previous editable cell
                    const currentRowIndex = allTransactions.findIndex(t => t.id === transaction.id);
                    const prevColumn = getNextEditableColumn("category", "left");

                    if (prevColumn === editableColumns[editableColumns.length - 1]) {
                      // Wrapped to previous row
                      const prevRowIndex = Math.max(currentRowIndex - 1, 0);
                      const prevTransaction = allTransactions[prevRowIndex];
                      if (prevTransaction) {
                        setFocusedRowIndex(prevRowIndex);
                        setFocusedColumnId(prevColumn);
                        // Open edit for previous cell
                        if (prevColumn === 'description') {
                          setEditingRow(prevTransaction.id);
                          setEditingField('description');
                        } else if (prevColumn === 'category') {
                          setEditingCategoryForTransaction(prevTransaction.id);
                        } else if (prevColumn === 'tags') {
                          setEditingTagsForTransaction(prevTransaction.id);
                        }
                      }
                    } else {
                      setFocusedRowIndex(currentRowIndex);
                      setFocusedColumnId(prevColumn);
                      // Open edit for previous cell in same row
                      if (prevColumn === 'description') {
                        setEditingRow(transaction.id);
                        setEditingField('description');
                      } else if (prevColumn === 'category') {
                        setEditingCategoryForTransaction(transaction.id);
                      } else if (prevColumn === 'tags') {
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
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded whitespace-nowrap"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingCategoryForTransaction(transaction.id);
                }}
                title="Click to edit category"
              >
                {category ? (
                  <Badge
                    variant="secondary"
                    className="text-xs font-medium inline-flex items-center max-w-[120px]"
                    style={{
                      backgroundColor: category.color ? `${category.color}20` : undefined,
                      borderColor: category.color ? `${category.color}40` : undefined,
                      color: category.color || undefined,
                    }}
                  >
                    <span className="truncate">{category.name}</span>
                  </Badge>
                ) : categoryName ? (
                  <span
                    className="text-xs text-gray-500 italic"
                    title={`${categoryName} (deleted)`}
                  >
                    {categoryName} (deleted)
                  </span>
                ) : (
                  <span className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    Click to add category
                  </span>
                )}
                {row.original.subcategory && (
                  <div className="text-xs text-gray-500 mt-1 truncate max-w-[120px]">
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
            <div className="flex items-center gap-1 text-sm font-medium">
              <TagIcon className="h-4 w-4" />
              Tags
            </div>
          ),
          cell: ({ getValue, row }) => {
            const tagNames = getValue();
            const transaction = row.original;
            const tagObjects = convertStringTagsToObjects(tagNames || [], allTags);
            const isEditingTags = editingTagsForTransaction === transaction.id;



            if (isEditingTags) {
              return (
                <InlineTagDropdown
                  transactionId={transaction.id}
                  currentTags={tagNames || []}
                  onCancel={() => {
                    setEditingTagsForTransaction(null);
                    // Maintain keyboard navigation state after canceling tags edit
                    const currentRowIndex = allTransactions.findIndex(t => t.id === transaction.id);
                    setFocusedRowIndex(currentRowIndex);
                    setFocusedColumnId("tags");
                    setIsKeyboardNavigationMode(true);
                  }}
                  onSuccess={() => {
                    setEditingTagsForTransaction(null);
                    // Maintain keyboard navigation state after tags selection
                    const currentRowIndex = allTransactions.findIndex(t => t.id === transaction.id);
                    setFocusedRowIndex(currentRowIndex);
                    setFocusedColumnId("tags");
                    setIsKeyboardNavigationMode(true);
                  }}
                  onTabNext={() => {
                    // Close current edit
                    setEditingTagsForTransaction(null);

                    // Move to next editable cell
                    const currentRowIndex = allTransactions.findIndex(t => t.id === transaction.id);
                    const nextColumn = getNextEditableColumn("tags", "right");

                    if (nextColumn === editableColumns[0]) {
                      // Wrapped to next row
                      const nextRowIndex = Math.min(currentRowIndex + 1, allTransactions.length - 1);
                      const nextTransaction = allTransactions[nextRowIndex];
                      if (nextTransaction) {
                        setFocusedRowIndex(nextRowIndex);
                        setFocusedColumnId(nextColumn);
                        // Open edit for next cell
                        if (nextColumn === 'description') {
                          setEditingRow(nextTransaction.id);
                          setEditingField('description');
                        } else if (nextColumn === 'category') {
                          setEditingCategoryForTransaction(nextTransaction.id);
                        } else if (nextColumn === 'tags') {
                          setEditingTagsForTransaction(nextTransaction.id);
                        }
                      }
                    } else {
                      setFocusedRowIndex(currentRowIndex);
                      setFocusedColumnId(nextColumn);
                      // Open edit for next cell in same row
                      if (nextColumn === 'description') {
                        setEditingRow(transaction.id);
                        setEditingField('description');
                      } else if (nextColumn === 'category') {
                        setEditingCategoryForTransaction(transaction.id);
                      } else if (nextColumn === 'tags') {
                        setEditingTagsForTransaction(transaction.id);
                      }
                    }
                    setIsKeyboardNavigationMode(true);
                  }}
                  onTabPrevious={() => {
                    // Close current edit
                    setEditingTagsForTransaction(null);

                    // Move to previous editable cell
                    const currentRowIndex = allTransactions.findIndex(t => t.id === transaction.id);
                    const prevColumn = getNextEditableColumn("tags", "left");

                    if (prevColumn === editableColumns[editableColumns.length - 1]) {
                      // Wrapped to previous row
                      const prevRowIndex = Math.max(currentRowIndex - 1, 0);
                      const prevTransaction = allTransactions[prevRowIndex];
                      if (prevTransaction) {
                        setFocusedRowIndex(prevRowIndex);
                        setFocusedColumnId(prevColumn);
                        // Open edit for previous cell
                        if (prevColumn === 'description') {
                          setEditingRow(prevTransaction.id);
                          setEditingField('description');
                        } else if (prevColumn === 'category') {
                          setEditingCategoryForTransaction(prevTransaction.id);
                        } else if (prevColumn === 'tags') {
                          setEditingTagsForTransaction(prevTransaction.id);
                        }
                      }
                    } else {
                      setFocusedRowIndex(currentRowIndex);
                      setFocusedColumnId(prevColumn);
                      // Open edit for previous cell in same row
                      if (prevColumn === 'description') {
                        setEditingRow(transaction.id);
                        setEditingField('description');
                      } else if (prevColumn === 'category') {
                        setEditingCategoryForTransaction(transaction.id);
                      } else if (prevColumn === 'tags') {
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
                className="flex gap-1 overflow-x-auto [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-gray-700 dark:hover:[&::-webkit-scrollbar-thumb]:bg-gray-600 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded max-w-[140px]"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTagsForTransaction(transaction.id);
                }}
                title="Click to edit tags"
              >
                {tagObjects && tagObjects.length > 0 ? (
                  <div className="flex gap-1 whitespace-nowrap">
                    {tagObjects.map((tag) => (
                      <TagPill
                        key={tag.id}
                        tag={tag}
                        variant="compact"
                        className="text-xs flex-shrink-0"
                        onRemove={async (tagId) => {
                          try {
                            const remainingTags = tagObjects.filter(t => t.id !== tagId);
                            await updateTransaction.mutateAsync({
                              id: transaction.id,
                              updates: {
                                tags: remainingTags.map(t => t.name),
                              },
                            });
                            toast.success("Tag removed successfully");
                          } catch (error) {
                            toast.error("Failed to remove tag");
                            console.error("Remove tag error:", error);
                          }
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 whitespace-nowrap">Click to add tags</span>
                )}
              </div>
            );
          },
          size: 120,
        }),

        // Actions column - 6 buttons: Shared, Transfer, Parent, Split, Links, Flag
        columnHelper.display({
          id: "actions",
          header: () => null,
          cell: ({ row }) => {
            const transaction = row.original;

            // Find transaction group for transfers, splits, or grouped expenses
            const transactionGroup = transaction.transaction_group_id
              ? allTransactionsUnfiltered.filter(t => t.transaction_group_id === transaction.transaction_group_id)
              : [];

            const isSplitGroup = !!transaction.transaction_group_id &&
              (transaction.is_split === true || transactionGroup.some(t => t.is_split === true));

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
                handleHighlightTransactions(transactionGroup.map(t => t.id));
              }
            };

            const isFocusedRow = isKeyboardNavigationMode && focusedRowIndex === allTransactions.findIndex(t => t.id === transaction.id);
            const isFocusedActionsColumn = isFocusedRow && focusedColumnId === 'actions';

            return (
              <div className="flex justify-center items-center gap-1">
                {/* 1. Shared button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200",
                    transaction.is_shared
                      ? "bg-blue-100 text-blue-600 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-400 dark:hover:bg-blue-800"
                      : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700",
                    isFocusedActionsColumn && focusedActionButton === 0 && "ring-2 ring-blue-500 ring-inset"
                  )}
                  onClick={() => {
                    setSelectedTransactionForSplit(transaction);
                    setIsSplitEditorOpen(true);
                  }}
                  title={transaction.is_shared ? "Shared expense (mark as personal)" : "Share expenses"}
                >
                  <Users className="h-3.5 w-3.5" />
                </Button>

                {/* 2. Group expense - before Split; glows when in a group; always opens modal (no ungroup) */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200",
                    transaction.transaction_group_id && !transaction.is_split
                      ? "bg-purple-100 text-purple-600 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-400 dark:hover:bg-purple-800 shadow-[0_0_12px_rgba(147,51,234,0.5)] dark:shadow-[0_0_12px_rgba(147,51,234,0.4)]"
                      : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700",
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

                {/* 3. Split button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200",
                    isSplitGroup
                      ? "bg-purple-100 text-purple-600 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-400 dark:hover:bg-purple-800"
                      : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700",
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
                  title={isSplitGroup ? "View split transaction group" : "Split transaction"}
                >
                  <Split className="h-3.5 w-3.5" />
                </Button>

                {/* 4. Links button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200",
                    transaction.related_mails && transaction.related_mails.length > 0
                      ? "bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-400 dark:hover:bg-amber-800"
                      : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700",
                    isFocusedActionsColumn && focusedActionButton === 3 && "ring-2 ring-blue-500 ring-inset"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEmailLinksTransaction(transaction);
                    setIsEmailLinksDrawerOpen(true);
                  }}
                  title={
                    transaction.related_mails && transaction.related_mails.length > 0
                      ? `${transaction.related_mails.length} email(s) linked`
                      : "Link emails"
                  }
                >
                  <Link2 className="h-3.5 w-3.5" />
                </Button>

                {/* 5. Warning/Flag button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200 flex items-center justify-center border",
                    transaction.is_flagged === true
                      ? "border-orange-500 text-orange-600 hover:border-orange-600 hover:text-orange-700 dark:border-orange-400 dark:text-orange-400 dark:hover:border-orange-300 dark:hover:text-orange-300 bg-orange-50 dark:bg-orange-950"
                      : "border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500 dark:border-gray-600 dark:text-gray-500 dark:hover:border-gray-500 dark:hover:text-gray-400 bg-transparent",
                    isFocusedActionsColumn && focusedActionButton === 4 && "ring-2 ring-blue-500 ring-inset"
                  )}
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await updateTransaction.mutateAsync({
                        id: transaction.id,
                        updates: {
                          is_flagged: !(transaction.is_flagged === true),
                        },
                      });
                      toast.success(transaction.is_flagged === true ? "Warning removed" : "Transaction marked for review");
                    } catch (error) {
                      console.error("Failed to update flag status:", error);
                      toast.error("Failed to update warning status");
                    }
                  }}
                  title={transaction.is_flagged === true ? "Remove warning" : "Mark for review"}
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                </Button>

                {/* 6. Toggle direction button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200 flex items-center justify-center border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-300 bg-transparent",
                    isFocusedActionsColumn && focusedActionButton === 5 && "ring-2 ring-blue-500 ring-inset"
                  )}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const nextDirection = transaction.direction === "debit" ? "credit" : "debit";
                    try {
                      await updateTransaction.mutateAsync({
                        id: transaction.id,
                        updates: {
                          direction: nextDirection,
                        },
                      });
                      toast.success(`Marked as ${nextDirection === "credit" ? "credit (money in)" : "debit (money out)"}`);
                    } catch (error) {
                      console.error("Failed to toggle direction:", error);
                      toast.error("Failed to toggle transaction direction");
                    }
                  }}
                  title={`Mark as ${transaction.direction === "debit" ? "credit" : "debit"}`}
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                </Button>

                {/* 7. Delete button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200 flex items-center justify-center border border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500 dark:border-gray-600 dark:text-gray-500 dark:hover:border-gray-500 dark:hover:text-gray-400 bg-transparent",
                    isFocusedActionsColumn && focusedActionButton === 6 && "ring-2 ring-blue-500 ring-inset"
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

                {/* 8. PDF viewer button - only show if transaction has source_file */}
                {transaction.source_file && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 w-7 p-0 rounded-full transition-all duration-200 flex items-center justify-center border border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500 dark:border-gray-600 dark:text-gray-500 dark:hover:border-gray-500 dark:hover:text-gray-400 bg-transparent",
                      isFocusedActionsColumn && focusedActionButton === 7 && "ring-2 ring-blue-500 ring-inset"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPdfViewerTransactionId(transaction.id);
                      setIsPdfViewerOpen(true);
                    }}
                    title="View source PDF"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            );
          },
          size: 250,
        }),
      ];
    },
    [editingRow, editingField, allTags, allCategories, editingTagsForTransaction, editingCategoryForTransaction, isMultiSelectMode, selectedTransactionIds, isAllSelected, isIndeterminate, allTransactions, updateTransaction]
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

  const parentRef = React.useRef<HTMLDivElement>(null);

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
          <span className="ml-2 text-gray-900 dark:text-white">Loading transactions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-8">
        <div className="text-center text-red-600 dark:text-red-400">
          Error loading transactions: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                Transactions ({allTransactions.length} loaded{data?.pages?.[0]?.pagination?.total ? ` of ${data.pages[0].pagination.total}` : ''})
              </h3>
              {isKeyboardNavigationMode && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    ⌨️ Keyboard Navigation Active
                  </Badge>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Tab: Save & move right • Enter: Edit • Arrow keys: Navigate • Esc: Exit
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
            {!isMultiSelectMode && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsMultiSelectMode(true);
                    // Initialize focused row index when entering multi-select mode
                    if (allTransactions.length > 0) {
                      setFocusedRowIndex(0);
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  <CheckSquare className="h-4 w-4" />
                  Multi-Select
                </Button>
              </>
            )}
            {isMultiSelectMode && (
              <>
                <Badge variant="secondary" className="text-sm">
                  {selectionSummary.total} selected
                  {selectionSummary.total > 0 && (
                    <span className="ml-1 text-xs text-gray-500">
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
              </>
            )}
            </div>
          </div>
          {isFetchingNextPage && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              Loading more...
            </div>
          )}
        </div>
      </div>

      <div className="w-full" style={{ height: "70vh", display: "flex", flexDirection: "column" }}>
        {/* Sticky Header */}
        <div
          ref={headerScrollRef}
          className="flex-shrink-0 w-full overflow-x-auto bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-md z-50"
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
                      className="relative px-3 py-2 text-left font-semibold text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-800 h-12 align-middle text-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
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
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-blue-400 active:bg-blue-500 rounded transition-colors"
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
          className="flex-1 overflow-auto relative w-full"
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
              {rows.map((row, rowIndex) => {
                const isFocusedRow = isKeyboardNavigationMode && focusedRowIndex === rowIndex;
                const isGroupedExpense = row.original.is_grouped_expense;
                const isExpanded = row.original.transaction_group_id 
                  ? expandedGroupedExpenses.has(row.original.transaction_group_id)
                  : false;
                const members = row.original.transaction_group_id 
                  ? groupMembers.get(row.original.transaction_group_id) || []
                  : [];
                
                return (
                  <React.Fragment key={row.id}>
                    <tr
                      className={cn(
                        "group hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 transition-colors duration-150 h-12 cursor-pointer",
                        editingRow === row.original.id && "bg-blue-50 dark:bg-blue-900/20",
                        highlightedTransactionIds.has(row.original.id) && "bg-blue-50 dark:bg-blue-900/10 border-l-2 border-l-blue-500",
                        isFocusedRow && "bg-blue-100 dark:bg-blue-900/30 border-l-2 border-l-blue-500"
                      )}
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
                              isFocusedCell && "ring-2 ring-blue-500 ring-inset bg-blue-50 dark:bg-blue-900/20"
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
                        className="bg-purple-50/50 dark:bg-purple-950/10 border-l-2 border-purple-300 dark:border-purple-700 hover:bg-purple-100/50 dark:hover:bg-purple-900/20"
                      >
                        {isMultiSelectMode && <td className="px-3 py-2"></td>}
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 pl-8">
                          {format(new Date(member.date), "dd MMM yy")}
                        </td>
                        <td className="px-3 py-2 pl-12 min-w-0">
                          <div className="text-sm truncate">{member.description}</div>
                          {member.notes && (
                            <div className="text-xs text-gray-500 truncate">{member.notes}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs",
                              member.direction === "debit"
                                ? "border-red-500 text-red-600 dark:text-red-400"
                                : "border-green-500 text-green-600 dark:text-green-400"
                            )}
                          >
                            {formatCurrency(member.amount)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-xs">{member.account.split(" ").slice(0, -2).join(" ")}</td>
                        <td className="px-3 py-2 text-xs">{member.category || "Uncategorized"}</td>
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2"></td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!hasNextPage && allTransactions.length > 0 && (
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            All transactions loaded ({allTransactions.length} total)
          </div>
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
        <SplitEditor
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
            } catch (error) {
              console.error("Failed to save split breakdown:", error);
              // TODO: Show error message to user
            }
          }}
          onClearSplit={async () => {
            try {
              await clearTransactionSplit.mutateAsync(selectedTransactionForSplit.id);
              setIsSplitEditorOpen(false);
              setSelectedTransactionForSplit(null);
            } catch (error) {
              console.error("Failed to clear split:", error);
              // TODO: Show error message to user
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
            } catch (error) {
              toast.error("Failed to group transfer");
              console.error("Group transfer error:", error);
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
            } catch (error) {
              toast.error("Failed to ungroup transfer");
              console.error("Ungroup transfer error:", error);
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
            } catch (error) {
              toast.error("Failed to add to transfer group");
              console.error("Add to transfer group error:", error);
            }
          }}
          onRemoveFromGroup={async (transactionId) => {
            try {
              await updateTransaction.mutateAsync({
                id: transactionId,
                updates: { transaction_group_id: undefined },
              });
              toast.success("Transaction removed from transfer group");
            } catch (error) {
              toast.error("Failed to remove from transfer group");
              console.error("Remove from transfer group error:", error);
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
            } catch (error) {
              console.error("Failed to ungroup:", error);
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
            } catch (error) {
              console.error("Failed to remove from group:", error);
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
          } catch (error) {
            console.error("Failed to delete transaction(s):", error);
            toast.error("Failed to delete transaction(s)");
          }
        }}
        transactions={transactionToDelete ? [transactionToDelete] : allTransactions.filter(t => selectedTransactionIds.has(t.id))}
        isLoading={deleteTransaction.isPending || bulkDeleteTransactions.isPending}
      />
    </div>
  );
}
