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
import { useInfiniteTransactions, useUpdateTransactionSplit, useClearTransactionSplit, useUpdateTransaction } from "@/hooks/use-transactions";
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
  Unlink
} from "lucide-react";
import { format } from "date-fns";
import { TransactionEditModal } from "./transaction-edit-modal";
import { TransactionInlineEdit } from "./transaction-inline-edit";
import { SplitEditor } from "./split-editor";
import { TagPill } from "./tag-pill";
import { InlineTagDropdown } from "./inline-tag-dropdown";
import { InlineCategoryDropdown } from "./inline-category-dropdown";
import { BulkEditModal } from "./bulk-edit-modal";
import { LinksColumn } from "./links-column";
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
  const [editingTagsForTransaction, setEditingTagsForTransaction] = useState<string | null>(null);
  const [editingCategoryForTransaction, setEditingCategoryForTransaction] = useState<string | null>(null);
  const [selectedTransactionIds, setSelectedTransactionIds] = useState<Set<string>>(new Set());
  const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const updateTransactionSplit = useUpdateTransactionSplit();
  const clearTransactionSplit = useClearTransactionSplit();
  const updateTransaction = useUpdateTransaction();
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
  
  // Debug logging for transaction data
  useEffect(() => {
    if (data?.pages) {
      console.warn('🔍 Transaction data updated:', data.pages[0]?.data?.slice(0, 3));
    }
  }, [data]);

  // Flatten all transactions from all pages
  const allTransactions = useMemo(() => {
    return data?.pages.flatMap(page => page.data) || [];
  }, [data]);

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

  // Bulk action logic
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
    const amounts = selectedTransactions.map(t => Math.abs(t.amount));
    const amountsSimilar = amounts.every(amount => 
      Math.abs(amount - amounts[0]) < amounts[0] * 0.1 // 10% tolerance
    );
    return hasDebit && hasCredit && amountsSimilar;
  }, [selectedTransactions]);

  const canBulkUnlink = useMemo(() => {
    return selectedTransactions.some(t => 
      t.link_parent_id || t.transfer_group_id
    );
  }, [selectedTransactions]);

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
              apiClient.updateTransaction(id, { transfer_group_id: undefined })
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
        .filter(t => t.link_parent_id || t.transfer_group_id)
        .map(t => 
          apiClient.updateTransaction(t.id, {
            link_parent_id: undefined,
            transfer_group_id: undefined,
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

  useEffect(() => {
    fetchMoreOnBottomReached(tableContainerRef.current);
  }, [fetchMoreOnBottomReached]);

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
                }}
                onSuccess={() => {
                  setEditingRow(null);
                  setEditingField(null);
                }}
              />
            );
          }
          
          const description = getValue();
          const fullText = row.original.notes ? `${description} - ${row.original.notes}` : description;
          
          return (
            <div 
              className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded"
              onClick={() => {
                setEditingRow(row.original.id);
                setEditingField("description");
              }}
            >
              <div className="font-medium text-sm truncate max-w-[320px] md:max-w-[300px]" title={fullText}>
                {description}
              </div>
              {row.original.notes && (
                <div className="text-xs text-gray-500 truncate max-w-[320px] md:max-w-[300px]" title={row.original.notes}>
                  {row.original.notes}
                </div>
              )}
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
          const totalAmount = getValue();
          const splitAmount = row.original.split_share_amount;
          const direction = row.original.direction;
          const isShared = row.original.is_shared;
          
          // For shared transactions, show the effective amount (my share) as primary
          const displayAmount = isShared && splitAmount ? splitAmount : totalAmount;
          const showTotalAmount = isShared && splitAmount && splitAmount !== totalAmount;
          
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
               {showTotalAmount && (
                 <div className="text-xs text-gray-500 mt-1 text-right">
                   Total: {formatCurrency(totalAmount)}
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
       size: 130,
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
                onCancel={() => setEditingCategoryForTransaction(null)}
                onSuccess={() => setEditingCategoryForTransaction(null)}
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
        size: 130,
      }),
      
       // Shared toggle column
       columnHelper.display({
         id: "shared",
         header: () => (
           <div className="flex items-center justify-center gap-1 text-sm font-medium">
             <Users className="h-4 w-4" />
             Shared
           </div>
         ),
         cell: ({ row }) => {
           const transaction = row.original;
           return (
             <div className="flex justify-center items-center">
               <Button
                 variant="ghost"
                 size="sm"
                 className={cn(
                   "h-8 w-8 p-0 rounded-full transition-all duration-200",
                   transaction.is_shared
                     ? "bg-blue-100 text-blue-600 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-400 dark:hover:bg-blue-800"
                     : "bg-gray-100 text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700"
                 )}
                 onClick={() => {
                   setSelectedTransactionForSplit(transaction);
                   setIsSplitEditorOpen(true);
                 }}
                 title={transaction.is_shared ? "Mark as personal" : "Mark as shared"}
               >
                 <Users className="h-4 w-4" />
               </Button>
             </div>
           );
         },
        size: 80,
      }),
      
      // Links column
      columnHelper.display({
        id: "links",
        header: () => (
          <div className="flex items-center justify-center gap-1 text-sm font-medium">
            <Link2 className="h-4 w-4" />
            Links
          </div>
        ),
        cell: ({ row }) => {
          const transaction = row.original;
          return (
            <LinksColumn
              transaction={transaction}
              allTransactions={allTransactions}
              onLinkRefund={async (childId, parentId) => {
                try {
                  await updateTransaction.mutateAsync({
                    id: childId,
                    updates: {
                      link_parent_id: parentId,
                      is_refund: true,
                    },
                  });
                  toast.success("Refund linked successfully", {
                    action: {
                      label: "Undo",
                      onClick: async () => {
                        await updateTransaction.mutateAsync({
                          id: childId,
                          updates: {
                            link_parent_id: undefined,
                            is_refund: false,
                          },
                        });
                      },
                    },
                  });
                } catch (error) {
                  toast.error("Failed to link refund");
                  console.error("Link refund error:", error);
                }
              }}
              onUnlinkRefund={async (childId) => {
                try {
                  await updateTransaction.mutateAsync({
                    id: childId,
                    updates: {
                      link_parent_id: undefined,
                      is_refund: false,
                    },
                  });
                  toast.success("Refund unlinked successfully", {
                    action: {
                      label: "Undo",
                      onClick: async () => {
                        // This would need the original parent ID to restore
                        // For now, we'll just show the toast without undo
                      },
                    },
                  });
                } catch (error) {
                  toast.error("Failed to unlink refund");
                  console.error("Unlink refund error:", error);
                }
              }}
              onGroupTransfer={async (transactionIds) => {
                try {
                  await apiClient.groupTransfer(transactionIds);
                  toast.success(`Grouped ${transactionIds.length} transactions as a transfer`, {
                    action: {
                      label: "Undo",
                      onClick: async () => {
                        // Ungroup by setting transfer_group_id to undefined for all
                        const updatePromises = transactionIds.map(id => 
                          updateTransaction.mutateAsync({
                            id,
                            updates: { transfer_group_id: undefined },
                          })
                        );
                        await Promise.all(updatePromises);
                      },
                    },
                  });
                } catch (error) {
                  toast.error("Failed to group transfer");
                  console.error("Group transfer error:", error);
                }
              }}
              onUngroupTransfer={async (transactionId) => {
                try {
                  await updateTransaction.mutateAsync({
                    id: transactionId,
                    updates: { transfer_group_id: undefined },
                  });
                  toast.success("Transfer ungrouped successfully", {
                    action: {
                      label: "Undo",
                      onClick: async () => {
                        // This would need the original group ID to restore
                        // For now, we'll just show the toast without undo
                      },
                    },
                  });
                } catch (error) {
                  toast.error("Failed to ungroup transfer");
                  console.error("Ungroup transfer error:", error);
                }
              }}
              onAddToTransferGroup={async (transactionIds) => {
                try {
                  const targetGroupId = transaction.transfer_group_id;
                  const updatePromises = transactionIds.map(id => 
                    updateTransaction.mutateAsync({
                      id,
                      updates: { transfer_group_id: targetGroupId },
                    })
                  );
                  await Promise.all(updatePromises);
                  toast.success(`Added ${transactionIds.length} transactions to transfer group`, {
                    action: {
                      label: "Undo",
                      onClick: async () => {
                        const unlinkPromises = transactionIds.map(id => 
                          updateTransaction.mutateAsync({
                            id,
                            updates: { transfer_group_id: undefined },
                          })
                        );
                        await Promise.all(unlinkPromises);
                      },
                    },
                  });
                } catch (error) {
                  toast.error("Failed to add to transfer group");
                  console.error("Add to transfer group error:", error);
                }
              }}
              onRemoveFromTransferGroup={async (transactionId) => {
                try {
                  await updateTransaction.mutateAsync({
                    id: transactionId,
                    updates: { transfer_group_id: undefined },
                  });
                  toast.success("Transaction removed from transfer group", {
                    action: {
                      label: "Undo",
                      onClick: async () => {
                        // This would need the original group ID to restore
                        // For now, we'll just show the toast without undo
                      },
                    },
                  });
                } catch (error) {
                  toast.error("Failed to remove from transfer group");
                  console.error("Remove from transfer group error:", error);
                }
              }}
            />
          );
        },
        size: 100,
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
           
           // Always log for the first few transactions to debug
           if (row.index < 3) {
             console.warn(`🔍 Transaction ${row.index}:`, {
               id: transaction.id,
               tagNames,
               allTagsCount: allTags.length,
               tagObjectsCount: tagObjects.length
             });
           }
           
           // Debug logging
           if (tagNames && tagNames.length > 0) {
             console.warn(`🔍 Transaction ${transaction.id} has tags:`, tagNames);
             console.warn('🔍 All tags available:', allTags);
             console.warn('🔍 Converted tag objects:', tagObjects);
           }
           
           if (isEditingTags) {
             return (
               <InlineTagDropdown
                 transactionId={transaction.id}
                 currentTags={tagNames || []}
                 onCancel={() => setEditingTagsForTransaction(null)}
                 onSuccess={() => setEditingTagsForTransaction(null)}
               />
             );
           }
           
          return (
            <div 
              className="flex gap-1 overflow-x-auto [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-gray-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-gray-300 dark:[&::-webkit-scrollbar-thumb]:bg-gray-700 dark:hover:[&::-webkit-scrollbar-thumb]:bg-gray-600 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded max-w-[180px]"
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
        size: 200,
      }),
      
      // Actions column (3-dot menu)
      columnHelper.display({
        id: "actions",
        header: () => null,
        cell: ({ row }) => {
          const transaction = row.original;
          return (
            <div className="flex justify-center items-center opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => {
                    setSelectedTransactionId(transaction.id);
                    setIsEditModalOpen(true);
                  }}>
                    <Edit3 className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEditingTagsForTransaction(transaction.id)}>
                    <TagIcon className="h-4 w-4 mr-2" />
                    Edit Tags
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
        size: 50,
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
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              Transactions ({allTransactions.length} loaded{data?.pages?.[0]?.pagination?.total ? ` of ${data.pages[0].pagination.total}` : ''})
            </h3>
            {!isMultiSelectMode && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsMultiSelectMode(true)}
                className="flex items-center gap-2"
              >
                <CheckSquare className="h-4 w-4" />
                Multi-Select
              </Button>
            )}
            {isMultiSelectMode && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-sm">
                  {selectedTransactionIds.size} selected
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
                  title="Link refund (select one debit and one credit)"
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
                  title="Group as transfer (select 2+ transactions with opposite directions)"
                >
                  <GitBranch className="h-4 w-4" />
                  Group transfer
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkUnlink}
                  className="flex items-center gap-2"
                  disabled={!canBulkUnlink}
                  title="Unlink/ungroup selected transactions"
                >
                  <Unlink className="h-4 w-4" />
                  Unlink/Ungroup
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
        <div className="flex-shrink-0 w-full overflow-x-auto bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-md z-50">
          <table className={`w-full ${isMultiSelectMode ? 'min-w-[1140px]' : 'min-w-[1100px]'} table-auto md:table-fixed`}>
            <colgroup>
              {isMultiSelectMode && <col className="w-[40px]" />}
              <col className="w-[100px]" />
              <col className="w-[350px] md:w-[320px]" />
              <col className="w-[120px]" />
              <col className="w-[130px]" />
              <col className="w-[130px]" />
              <col className="w-[80px]" />
              <col className="w-[100px]" />
              <col className="w-[200px]" />
              <col className="w-[50px]" />
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
          className="flex-1 overflow-auto relative w-full"
          ref={(node) => {
            parentRef.current = node;
            tableContainerRef.current = node;
          }}
          onScroll={(e) => fetchMoreOnBottomReached(e.target as HTMLDivElement)}
        >
          <table className={`w-full ${isMultiSelectMode ? 'min-w-[1140px]' : 'min-w-[1100px]'} table-auto md:table-fixed`}>
            <colgroup>
              {isMultiSelectMode && <col className="w-[40px]" />}
              <col className="w-[100px]" />
              <col className="w-[350px] md:w-[320px]" />
              <col className="w-[120px]" />
              <col className="w-[130px]" />
              <col className="w-[130px]" />
              <col className="w-[80px]" />
              <col className="w-[100px]" />
              <col className="w-[200px]" />
              <col className="w-[50px]" />
            </colgroup>
            <tbody className="[&_tr:last-child]:border-0">
            {rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "group hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 transition-colors duration-150 h-12",
                  editingRow === row.original.id && "bg-blue-50 dark:bg-blue-900/20"
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td 
                    key={cell.id} 
                    className={cn(
                      "px-3 py-2 text-sm align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
                      editingTagsForTransaction === row.original.id && cell.column.id === "tags" && "relative",
                      editingCategoryForTransaction === row.original.id && cell.column.id === "category" && "relative"
                    )}
                  >
                    {flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext()
                    )}
                  </td>
                ))}
              </tr>
            ))}
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
              console.log("Split breakdown saved successfully");
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
              console.log("Split cleared successfully");
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
    </div>
  );
}
