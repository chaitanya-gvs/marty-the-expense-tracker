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
} from "@tanstack/react-table";
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
  GitBranch,
  CheckSquare,
  Square,
  Edit,
  Unlink,
  Split,
  RefreshCcw,
  AlertCircle,
  Trash2,
  FileText
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
import { SplitTransactionModal } from "./split-transaction-modal";
import { LinkParentModal } from "./link-parent-modal";
import { GroupTransferModal } from "./group-transfer-modal";
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
  onUngroup,
  onRemoveFromGroup,
}: {
  transaction: Transaction;
  allTransactions: Transaction[];
  allTransactionsUnfiltered: Transaction[];
  isOpen: boolean;
  onClose: () => void;
  onUnlink: () => void;
  onUngroup: () => void;
  onRemoveFromGroup: (transactionId: string) => void;
}) {
  const [fetchedParent, setFetchedParent] = useState<Transaction | undefined>(undefined);
  const [fetchedChildren, setFetchedChildren] = useState<Transaction[]>([]);
  const [fetchedGroup, setFetchedGroup] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Find parent transaction in loaded data
  const parentInLoaded = transaction.link_parent_id
    ? (allTransactions.find(t => t.id === transaction.link_parent_id) ||
      allTransactionsUnfiltered.find(t => t.id === transaction.link_parent_id))
    : undefined;

  // Find group in loaded data
  const groupInLoaded = transaction.transaction_group_id
    ? allTransactionsUnfiltered.filter(t => t.transaction_group_id === transaction.transaction_group_id)
    : [];

  // Fetch missing related transactions when drawer opens
  useEffect(() => {
    if (!isOpen) {
      // Reset when drawer closes
      setFetchedParent(undefined);
      setFetchedChildren([]);
      setFetchedGroup([]);
      return;
    }

    const fetchRelatedTransactions = async () => {
      setIsLoading(true);
      try {
        // Use the combined endpoint to get all related transactions at once
        try {
          const relatedResponse = await apiClient.getRelatedTransactions(transaction.id);
          if (relatedResponse.data) {
            // Set parent if it exists and wasn't in loaded data
            if (relatedResponse.data.parent && !parentInLoaded) {
              setFetchedParent(relatedResponse.data.parent);
            }

            // Set children if they exist (for debit transactions with refunds)
            if (relatedResponse.data.children && relatedResponse.data.children.length > 0) {
              setFetchedChildren(relatedResponse.data.children);
            }

            // Set group members if they exist and weren't in loaded data
            if (relatedResponse.data.group && relatedResponse.data.group.length > groupInLoaded.length) {
              setFetchedGroup(relatedResponse.data.group);
            }
          }
        } catch (error) {
          console.error("Failed to fetch related transactions:", error);
          // Fallback: try individual endpoints if combined endpoint fails

          // Fetch parent if missing
          if (transaction.link_parent_id && !parentInLoaded) {
            try {
              const parentResponse = await apiClient.getParentTransaction(transaction.id);
              if (parentResponse.data) {
                setFetchedParent(parentResponse.data);
              }
            } catch (parentError) {
              console.error("Failed to fetch parent transaction:", parentError);
            }
          }

          // Fetch group members if missing
          if (transaction.transaction_group_id && groupInLoaded.length <= 1) {
            try {
              const groupResponse = await apiClient.getGroupTransactions(transaction.id);
              if (groupResponse.data && groupResponse.data.length > groupInLoaded.length) {
                setFetchedGroup(groupResponse.data);
              }
            } catch (groupError) {
              console.error("Failed to fetch group transactions:", groupError);
            }
          }
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchRelatedTransactions();
  }, [isOpen, transaction.id, transaction.link_parent_id, transaction.transaction_group_id, parentInLoaded, groupInLoaded]);

  // Use fetched data if available, otherwise use loaded data
  const parentTransaction = parentInLoaded || fetchedParent;
  const childTransactions = fetchedChildren;
  const transferGroup = groupInLoaded.length > 0 ? groupInLoaded : fetchedGroup;

  return (
    <RelatedTransactionsDrawer
      transaction={transaction}
      parentTransaction={parentTransaction}
      childTransactions={childTransactions}
      transferGroup={transferGroup}
      isOpen={isOpen}
      onClose={onClose}
      onUnlink={onUnlink}
      onUngroup={onUngroup}
      onRemoveFromGroup={onRemoveFromGroup}
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
  const [linkParentModalTransaction, setLinkParentModalTransaction] = useState<Transaction | null>(null);
  const [groupTransferModalTransaction, setGroupTransferModalTransaction] = useState<Transaction | null>(null);
  const [emailLinksTransaction, setEmailLinksTransaction] = useState<Transaction | null>(null);
  const [isEmailLinksDrawerOpen, setIsEmailLinksDrawerOpen] = useState(false);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [pdfViewerTransactionId, setPdfViewerTransactionId] = useState<string | null>(null);
  const [isPdfViewerOpen, setIsPdfViewerOpen] = useState(false);

  // Keyboard navigation state
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);
  const [focusedColumnId, setFocusedColumnId] = useState<string | null>(null);
  const [isKeyboardNavigationMode, setIsKeyboardNavigationMode] = useState(false);
  const [focusedActionButton, setFocusedActionButton] = useState<number>(-1);

  const tableContainerRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);

  const updateTransactionSplit = useUpdateTransactionSplit();
  const clearTransactionSplit = useClearTransactionSplit();
  const updateTransaction = useUpdateTransaction();
  const bulkDeleteTransactions = useBulkDeleteTransactions();
  const deleteTransaction = useDeleteTransaction();
  const { data: allTags = [] } = useTags();
  const { data: allCategories = [] } = useCategories();

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
      // Filter out linked credit transactions (refunds) - they should only appear in the refund sidebar
      // This hides credit transactions that are linked as refunds to a parent debit transaction
      if (t.link_parent_id && t.direction === 'credit') {
        return false;
      }

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
  const canBulkLinkRefund = useMemo(() => {
    if (selectedTransactions.length !== 2) return false;
    const directions = selectedTransactions.map(t => t.direction);
    return directions.includes("debit") && directions.includes("credit");
  }, [selectedTransactions]);

  const canBulkGroupTransfer = useMemo(() => {
    if (selectedTransactions.length < 2) return false;
    const directions = selectedTransactions.map(t => t.direction);
    const hasDebit = directions.includes("debit");
    const hasCredit = directions.includes("credit");
    return hasDebit && hasCredit;
  }, [selectedTransactions]);

  const canBulkUnlink = useMemo(() => {
    return selectedTransactions.some(t =>
      t.link_parent_id || t.transaction_group_id
    );
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

  const handleBulkLinkRefund = async () => {
    if (!canBulkLinkRefund) return;

    const debitTransaction = selectedTransactions.find(t => t.direction === "debit");
    const creditTransaction = selectedTransactions.find(t => t.direction === "credit");

    if (!debitTransaction || !creditTransaction) return;

    try {
      await apiClient.linkRefund(creditTransaction.id, debitTransaction.id);
      toast.success("Refund linked successfully", {
        action: {
          label: "Undo",
          onClick: async () => {
            await apiClient.updateTransaction(creditTransaction.id, {
              link_parent_id: undefined,
              is_refund: false,
            });
          },
        },
      });
      setSelectedTransactionIds(new Set());
    } catch (error) {
      toast.error("Failed to link refund");
      console.error("Bulk link refund error:", error);
    }
  };

  const handleBulkGroupTransfer = async () => {
    if (!canBulkGroupTransfer) return;

    try {
      const transactionIds = selectedTransactions.map(t => t.id);
      await apiClient.groupTransfer(transactionIds);
      toast.success(`Grouped ${transactionIds.length} transactions as a transfer`, {
        action: {
          label: "Undo",
          onClick: async () => {
            const updatePromises = transactionIds.map(id =>
              apiClient.updateTransaction(id, { transaction_group_id: undefined })
            );
            await Promise.all(updatePromises);
          },
        },
      });
      setSelectedTransactionIds(new Set());
    } catch (error) {
      toast.error("Failed to group transfer");
      console.error("Bulk group transfer error:", error);
    }
  };

  const handleBulkUnlink = async () => {
    try {
      const updatePromises = selectedTransactions
        .filter(t => t.link_parent_id || t.transaction_group_id)
        .map(t =>
          apiClient.updateTransaction(t.id, {
            link_parent_id: undefined,
            transaction_group_id: undefined,
            is_refund: false,
          })
        );

      await Promise.all(updatePromises);

      const unlinkedCount = updatePromises.length;
      toast.success(`Unlinked ${unlinkedCount} transactions`, {
        action: {
          label: "Undo",
          onClick: () => {
            // Note: Full undo would require storing previous state
            toast.info("Undo not available for bulk operations");
          },
        },
      });
      setSelectedTransactionIds(new Set());
    } catch (error) {
      toast.error("Failed to unlink transactions");
      console.error("Bulk unlink error:", error);
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

  // Helper functions for aggregate refunds
  const getLinkedChildren = useCallback((transactionId: string) => {
    // Use allTransactionsUnfiltered to find linked children, since we filter out
    // credit transactions with link_parent_id from allTransactions
    return allTransactionsUnfiltered.filter(t => t.link_parent_id === transactionId);
  }, [allTransactionsUnfiltered]);

  const getAggregateRefund = useCallback((transactionId: string) => {
    const children = getLinkedChildren(transactionId);
    return children.reduce((sum, t) => sum + Math.abs(t.amount), 0);
  }, [getLinkedChildren]);

  // Handle action button clicks from keyboard navigation
  const handleActionButtonClick = useCallback((transaction: Transaction, buttonIndex: number) => {
    switch (buttonIndex) {
      case 0: // Shared button
        setSelectedTransactionForSplit(transaction);
        setIsSplitEditorOpen(true);
        break;
      case 1: // Transfer button
        const isTransferGroup = !!transaction.transaction_group_id && !transaction.is_split;
        if (isTransferGroup) {
          setDrawerTransaction(transaction);
          setIsDrawerOpen(true);
        } else {
          setGroupTransferModalTransaction(transaction);
        }
        break;
      case 2: // Parent/Refund button
        const isRefundLinked = !!transaction.link_parent_id ||
          allTransactions.some(t => t.link_parent_id === transaction.id);
        if (isRefundLinked) {
          setDrawerTransaction(transaction);
          setIsDrawerOpen(true);
        } else if (transaction.direction === "credit") {
          setLinkParentModalTransaction(transaction);
        }
        break;
      case 3: // Split button
        const isSplitGroup = !!transaction.transaction_group_id && transaction.is_split;
        if (isSplitGroup) {
          setDrawerTransaction(transaction);
          setIsDrawerOpen(true);
        } else {
          setSelectedTransactionForSplitting(transaction);
          setIsSplitTransactionModalOpen(true);
        }
        break;
      case 4: // Links button
        setEmailLinksTransaction(transaction);
        setIsEmailLinksDrawerOpen(true);
        break;
      case 5: // Flag button
        updateTransaction.mutate({
          id: transaction.id,
          updates: {
            is_flagged: !(transaction.is_flagged === true),
          },
        });
        break;
      case 6: { // Toggle direction button
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
      case 7: // Delete button
        setTransactionToDelete(transaction);
        setIsDeleteConfirmationOpen(true);
        break;
      case 8: // PDF viewer button
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
        if (focusedColumnId === 'actions' && focusedActionButton < 8) { // 9 action buttons (0-8)
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

        // Description column
        columnHelper.accessor("description", {
          header: () => (
            <div className="flex items-center gap-1 text-sm font-medium">
              <ShoppingCart className="h-4 w-4" />
              Description
            </div>
          ),
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
            const linkedChildren = getLinkedChildren(row.original.id);
            const hasLinkedChildren = linkedChildren.length > 0;
            const aggregateRefund = hasLinkedChildren ? getAggregateRefund(row.original.id) : 0;

            return (
              <div
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded"
                onClick={() => {
                  setEditingRow(row.original.id);
                  setEditingField("description");
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate max-w-[280px] md:max-w-[260px]" title={fullText}>
                      {description}
                    </div>
                    {row.original.notes && (
                      <div className="text-xs text-gray-500 truncate max-w-[280px] md:max-w-[260px]" title={row.original.notes}>
                        {row.original.notes}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          },
          size: 350,
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
            const getEffectiveAmount = (row: any) => {
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
                onClick={() => setEditingCategoryForTransaction(transaction.id)}
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
                onClick={() => setEditingTagsForTransaction(transaction.id)}
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

            // Find parent transaction for refunds (if this transaction is a child/refund)
            // Look in both filtered and unfiltered transactions to find parent even if filtered out
            const parentTransaction = transaction.link_parent_id
              ? (allTransactions.find(t => t.id === transaction.link_parent_id) ||
                allTransactionsUnfiltered.find(t => t.id === transaction.link_parent_id))
              : undefined;

            // Find children transactions (if this transaction is a parent)
            // NOTE: We use net_amount to detect if this transaction has refunds, rather than counting
            // children from allTransactionsUnfiltered, because allTransactionsUnfiltered is actually
            // filtered by the search query and may not include child transactions that don't match the search.
            // The backend computes net_amount which is always accurate regardless of frontend filters.
            // IMPORTANT: Only debit transactions can have refund children. Credit transactions with
            // link_parent_id are the refunds themselves, not parents.
            // CRITICAL: net_amount can be null (not undefined) for transactions without refunds.
            // The backend only sends net_amount when refunds actually exist (net < original), so we
            // just need to check if it's a number. We don't compare it to amount because for shared
            // transactions, amount is the user's share, not the original total.
            const hasRefunds = transaction.direction === 'debit' &&
              typeof transaction.net_amount === 'number';

            // Calculate childTransactions for hover highlighting (even though we use hasRefunds for detection)
            // We need this to highlight the actual child transactions when hovering
            const childTransactions = allTransactionsUnfiltered.filter(t => t.link_parent_id === transaction.id);

            // Find transaction group for transfers or splits (use unfiltered to include parent)
            const transactionGroup = transaction.transaction_group_id
              ? allTransactionsUnfiltered.filter(t => t.transaction_group_id === transaction.transaction_group_id)
              : [];

            // Determine if this is a transfer group or split group
            // Split group: has transaction_group_id and is_split=true (child) OR has transaction_group_id with children
            // Check transaction.is_split first, then check if any in group have is_split=true
            // NOTE: We check transaction.is_split directly because if it's true, this transaction is part of a split group
            // even if other group members aren't loaded due to filtering
            const isSplitGroup = !!transaction.transaction_group_id &&
              (transaction.is_split === true || transactionGroup.some(t => t.is_split === true));
            // Transfer group: has transaction_group_id, is not a split, and has at least one other member in loaded data
            // OR if it has transaction_group_id and is not split, it's potentially a transfer (even if other members filtered out)
            const isTransferGroup = !!transaction.transaction_group_id && !isSplitGroup &&
              (transactionGroup.length > 1 || transactionGroup.length === 1);

            // This transaction is part of a refund link if it has a parent ID OR has refunds (net_amount < amount)
            // Use net_amount instead of counting children to avoid issues with search-filtered data
            const isRefundLinked = !!transaction.link_parent_id || hasRefunds;
            const isCredit = transaction.direction === "credit";

            const handleRefundClick = () => {
              if (isRefundLinked) {
                // Active: open drawer to view relationship
                setDrawerTransaction(transaction);
                setIsDrawerOpen(true);
              } else if (isCredit) {
                // Inactive: open modal to link (only for credits)
                setLinkParentModalTransaction(transaction);
              }
            };

            const handleTransferClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();

              if (isTransferGroup) {
                // Active: open drawer to view group
                setDrawerTransaction(transaction);
                setIsDrawerOpen(true);
              } else if (!isSplitGroup) {
                // Inactive: open modal to group (only if not already in a split group)
                setGroupTransferModalTransaction(transaction);
              }
            };

            const handleSplitClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();

              if (isSplitGroup) {
                // Active: open drawer to view split group
                setDrawerTransaction(transaction);
                setIsDrawerOpen(true);
              }
            };

            const handleRefundHover = () => {
              if (isRefundLinked) {
                // Highlight parent + current, OR current + all children
                if (parentTransaction) {
                  handleHighlightTransactions([parentTransaction.id, transaction.id]);
                } else if (childTransactions.length > 0) {
                  handleHighlightTransactions([transaction.id, ...childTransactions.map(c => c.id)]);
                }
              }
            };

            const handleTransferHover = () => {
              if (isTransferGroup) {
                handleHighlightTransactions(transactionGroup.map(t => t.id));
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

                {/* 2. Transfer button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200",
                    isTransferGroup
                      ? "bg-sky-100 text-sky-600 hover:bg-sky-200 dark:bg-sky-900 dark:text-sky-400 dark:hover:bg-sky-800"
                      : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700",
                    isSplitGroup && "opacity-50 cursor-not-allowed",
                    isFocusedActionsColumn && focusedActionButton === 1 && "ring-2 ring-blue-500 ring-inset"
                  )}
                  onClick={handleTransferClick}
                  onMouseEnter={handleTransferHover}
                  onMouseLeave={handleClearHighlight}
                  title={isTransferGroup ? "View transfer group" : isSplitGroup ? "Cannot group (part of split)" : "Group as transfer"}
                  disabled={isSplitGroup}
                >
                  <span className="text-sm">⇄</span>
                </Button>

                {/* 3. Parent/Refund button - show for credits (to link) or any with children (to view) */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200",
                    isRefundLinked
                      ? cn(
                        "bg-emerald-100 text-emerald-600 hover:bg-emerald-200 dark:bg-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-800",
                        hasRefunds && "shadow-[0_0_15px_rgba(34,197,94,0.6)] dark:shadow-[0_0_15px_rgba(34,197,94,0.4)]"
                      )
                      : isCredit
                        ? "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700"
                        : "bg-gray-50 text-gray-300 dark:bg-gray-900 dark:text-gray-600 cursor-not-allowed",
                    !isCredit && !isRefundLinked && "opacity-30",
                    isFocusedActionsColumn && focusedActionButton === 2 && "ring-2 ring-blue-500 ring-inset"
                  )}
                  onClick={handleRefundClick}
                  onMouseEnter={handleRefundHover}
                  onMouseLeave={handleClearHighlight}
                  title={isRefundLinked ? "View refund relationship" : isCredit ? "Link to parent purchase" : "Not applicable for debits"}
                  disabled={!isCredit && !isRefundLinked}
                >
                  <span className="text-sm">↩︎</span>
                </Button>

                {/* 4. Split button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200",
                    isSplitGroup
                      ? "bg-purple-100 text-purple-600 hover:bg-purple-200 dark:bg-purple-900 dark:text-purple-400 dark:hover:bg-purple-800"
                      : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700",
                    isFocusedActionsColumn && focusedActionButton === 3 && "ring-2 ring-blue-500 ring-inset"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    // If transaction is already split (has transaction_group_id and is_split=true), show drawer
                    // Otherwise, open modal to split it
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

                {/* 5. Links button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200",
                    transaction.related_mails && transaction.related_mails.length > 0
                      ? "bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-400 dark:hover:bg-amber-800"
                      : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700",
                    isFocusedActionsColumn && focusedActionButton === 4 && "ring-2 ring-blue-500 ring-inset"
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

                {/* 6. Warning/Flag button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200 flex items-center justify-center border",
                    transaction.is_flagged === true
                      ? "border-orange-500 text-orange-600 hover:border-orange-600 hover:text-orange-700 dark:border-orange-400 dark:text-orange-400 dark:hover:border-orange-300 dark:hover:text-orange-300 bg-orange-50 dark:bg-orange-950"
                      : "border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500 dark:border-gray-600 dark:text-gray-500 dark:hover:border-gray-500 dark:hover:text-gray-400 bg-transparent",
                    isFocusedActionsColumn && focusedActionButton === 5 && "ring-2 ring-blue-500 ring-inset"
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

                {/* 7. Toggle direction button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200 flex items-center justify-center border border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-300 bg-transparent",
                    isFocusedActionsColumn && focusedActionButton === 6 && "ring-2 ring-blue-500 ring-inset"
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

                {/* 8. Delete button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 w-7 p-0 rounded-full transition-all duration-200 flex items-center justify-center border border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500 dark:border-gray-600 dark:text-gray-500 dark:hover:border-gray-500 dark:hover:text-gray-400 bg-transparent",
                    isFocusedActionsColumn && focusedActionButton === 7 && "ring-2 ring-blue-500 ring-inset"
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

                {/* 9. PDF viewer button - only show if transaction has source_file */}
                {transaction.source_file && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 w-7 p-0 rounded-full transition-all duration-200 flex items-center justify-center border border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500 dark:border-gray-600 dark:text-gray-500 dark:hover:border-gray-500 dark:hover:text-gray-400 bg-transparent",
                      isFocusedActionsColumn && focusedActionButton === 8 && "ring-2 ring-blue-500 ring-inset"
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
    state: {
      sorting,
    },
    columnResizeMode: "onChange",
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
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
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
            {!isMultiSelectMode && (
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
            )}
            {isMultiSelectMode && (
              <div className="flex items-center gap-2">
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
                  onClick={handleBulkLinkRefund}
                  className="flex items-center gap-2"
                  disabled={!canBulkLinkRefund}
                  title={canBulkLinkRefund ? "Link refund" : "Select exactly 2 transactions (1 debit + 1 credit)"}
                >
                  <Link2 className="h-4 w-4" />
                  Link refund
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkGroupTransfer}
                  className="flex items-center gap-2"
                  disabled={!canBulkGroupTransfer}
                  title={canBulkGroupTransfer ? "Group as transfer" : "Select 2+ transactions with opposite directions"}
                >
                  <GitBranch className="h-4 w-4" />
                  Group transfer
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
                  variant="outline"
                  size="sm"
                  onClick={handleBulkUnlink}
                  className="flex items-center gap-2"
                  disabled={!canBulkUnlink}
                  title={canBulkUnlink ? "Unlink/ungroup selected transactions" : "No linked/grouped transactions selected"}
                >
                  <Unlink className="h-4 w-4" />
                  Unlink/Ungroup
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
              </div>
            )}
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
          <table className={`w-full ${isMultiSelectMode ? 'min-w-[1180px]' : 'min-w-[1140px]'} table-auto md:table-fixed`}>
            <colgroup>
              {isMultiSelectMode && <col className="w-[40px]" />}
              <col className="w-[100px]" />
              <col className="w-[350px] md:w-[320px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
              <col className="w-[110px]" />
              <col className="w-[120px]" />
              <col className="w-[220px]" />
            </colgroup>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b transition-colors">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-3 py-2 text-left font-semibold text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-800 h-12 align-middle text-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
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
          <table className={`w-full ${isMultiSelectMode ? 'min-w-[1180px]' : 'min-w-[1140px]'} table-auto md:table-fixed`}>
            <colgroup>
              {isMultiSelectMode && <col className="w-[40px]" />}
              <col className="w-[100px]" />
              <col className="w-[350px] md:w-[320px]" />
              <col className="w-[120px]" />
              <col className="w-[110px]" />
              <col className="w-[110px]" />
              <col className="w-[120px]" />
              <col className="w-[220px]" />
            </colgroup>
            <tbody className="[&_tr:last-child]:border-0">
              {rows.map((row, rowIndex) => {
                const isFocusedRow = isKeyboardNavigationMode && focusedRowIndex === rowIndex;
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      "group hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 transition-colors duration-150 h-12",
                      editingRow === row.original.id && "bg-blue-50 dark:bg-blue-900/20",
                      highlightedTransactionIds.has(row.original.id) && "bg-blue-50 dark:bg-blue-900/10 border-l-2 border-l-blue-500",
                      isFocusedRow && "bg-blue-100 dark:bg-blue-900/30 border-l-2 border-l-blue-500"
                    )}
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

      {/* Link Parent Modal */}
      {linkParentModalTransaction && (
        <LinkParentModal
          transaction={linkParentModalTransaction}
          parentTransaction={
            linkParentModalTransaction.link_parent_id
              ? allTransactions.find(t => t.id === linkParentModalTransaction.link_parent_id)
              : undefined
          }
          allTransactions={allTransactions}
          isOpen={!!linkParentModalTransaction}
          onClose={() => setLinkParentModalTransaction(null)}
          onLink={async (parentId) => {
            try {
              await updateTransaction.mutateAsync({
                id: linkParentModalTransaction.id,
                updates: {
                  link_parent_id: parentId,
                  is_refund: true,
                },
              });
              toast.success("Refund linked successfully");
              setLinkParentModalTransaction(null);
            } catch (error) {
              toast.error("Failed to link refund");
              console.error("Link refund error:", error);
            }
          }}
          onUnlink={async () => {
            try {
              await updateTransaction.mutateAsync({
                id: linkParentModalTransaction.id,
                updates: {
                  link_parent_id: undefined,
                  is_refund: false,
                },
              });
              toast.success("Refund unlinked successfully");
              setLinkParentModalTransaction(null);
            } catch (error) {
              toast.error("Failed to unlink refund");
              console.error("Unlink refund error:", error);
            }
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
          }}
          onUnlink={async () => {
            await updateTransaction.mutateAsync({
              id: drawerTransaction.id,
              updates: {
                link_parent_id: undefined,
                is_refund: false,
              },
            });
            setIsDrawerOpen(false);
            setDrawerTransaction(null);
          }}
          onUngroup={async () => {
            try {
              // Ungroup all transactions in the group
              const transferGroupId = drawerTransaction.transaction_group_id;

              if (transferGroupId) {
                const groupTransactions = allTransactions.filter(t => t.transaction_group_id === transferGroupId);

                // Update all transactions in the group
                // Note: Must use null instead of undefined, as JSON.stringify removes undefined values
                await Promise.all(
                  groupTransactions.map(t =>
                    updateTransaction.mutateAsync({
                      id: t.id,
                      updates: { transaction_group_id: null as any },
                    })
                  )
                );

                toast.success("Transfer group removed successfully");

                // Wait a bit for cache to update before closing drawer
                await new Promise(resolve => setTimeout(resolve, 300));
              }
              setIsDrawerOpen(false);
              setDrawerTransaction(null);
            } catch (error) {
              console.error("Failed to ungroup transfer:", error);
              toast.error("Failed to ungroup transfer");
            }
          }}
          onRemoveFromGroup={async (transactionId) => {
            try {
              // Note: Must use null instead of undefined, as JSON.stringify removes undefined values
              await updateTransaction.mutateAsync({
                id: transactionId,
                updates: { transaction_group_id: null as any },
              });
              toast.success("Transaction removed from group");
              // Keep drawer open to show updated group
            } catch (error) {
              console.error("Failed to remove from group:", error);
              toast.error("Failed to remove transaction from group");
            }
          }}
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
