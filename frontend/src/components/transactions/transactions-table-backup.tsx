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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInfiniteTransactions } from "@/hooks/use-transactions";
import { Transaction, TransactionFilters, TransactionSort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  Edit, 
  Tag, 
  Link, 
  Users,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Edit3,
  CreditCard,
  Wallet
} from "lucide-react";
import { format } from "date-fns";
import { TransactionEditModal } from "./transaction-edit-modal";
import { TransactionInlineEdit } from "./transaction-inline-edit";
import { formatCurrency, formatDate } from "@/lib/format-utils";

const columnHelper = createColumnHelper<Transaction>();

// Helper function to process account names and get icons
const processAccountInfo = (accountName: string) => {
  // Remove last 2 words (e.g., "Savings Account", "Credit Card")
  const words = accountName.split(' ');
  const processedName = words.slice(0, -2).join(' ');
  
  // Determine if it's a credit card or savings account
  const isCreditCard = accountName.toLowerCase().includes('credit');
  const icon = isCreditCard ? <CreditCard className="h-3 w-3 mr-1" /> : <Wallet className="h-3 w-3 mr-1" />;
  
  return { processedName, icon, isCreditCard };
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
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteTransactions(filters, sort);

  // Flatten all transactions from all pages
  const allTransactions = useMemo(() => {
    return data?.pages.flatMap(page => page.data) || [];
  }, [data]);

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

  const columns = useMemo<ColumnDef<Transaction>[]>(
    () => [
      columnHelper.accessor("date", {
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-2"
          >
            Date
            {column.getIsSorted() === "asc" ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : column.getIsSorted() === "desc" ? (
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : (
              <ArrowUpDown className="ml-2 h-4 w-4" />
            )}
          </Button>
        ),
        cell: ({ getValue }) => {
          return formatDate(getValue());
        },
        size: 120,
      }),
      columnHelper.accessor("account", {
        header: "Account",
        cell: ({ getValue }) => (
          <Badge variant="outline" className="text-sm font-medium">{getValue()}</Badge>
        ),
        size: 150,
      }),
      columnHelper.accessor("description", {
        header: "Description",
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
          
          return (
            <div 
              className="max-w-[300px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded"
              onClick={() => {
                setEditingRow(row.original.id);
                setEditingField("description");
              }}
            >
              <div className="font-medium text-sm truncate">{getValue()}</div>
              {row.original.notes && (
                <div className="text-xs text-gray-500 truncate">
                  {row.original.notes}
                </div>
              )}
            </div>
          );
        },
        size: 250,
      }),
      columnHelper.accessor("category", {
        header: "Category",
        cell: ({ getValue, row }) => {
          const isEditing = editingRow === row.original.id && editingField === "category";
          
          if (isEditing) {
            return (
              <TransactionInlineEdit
                transaction={row.original}
                field="category"
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
          
          return (
            <div 
              className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded"
              onClick={() => {
                setEditingRow(row.original.id);
                setEditingField("category");
              }}
            >
              <Badge variant="secondary" className="text-xs font-medium">{getValue()}</Badge>
              {row.original.subcategory && (
                <div className="text-xs text-gray-500 mt-1">
                  {row.original.subcategory}
                </div>
              )}
            </div>
          );
        },
        size: 150,
      }),
      columnHelper.accessor("direction", {
        header: "Direction",
        cell: ({ getValue }) => (
          <Badge
            variant={getValue() === "debit" ? "destructive" : "default"}
            className="text-xs font-medium"
          >
            {getValue() === "debit" ? "Debit" : "Credit"}
          </Badge>
        ),
        size: 100,
      }),
      columnHelper.accessor("amount", {
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-2"
          >
            Amount
            {column.getIsSorted() === "asc" ? (
              <ArrowUp className="ml-2 h-4 w-4" />
            ) : column.getIsSorted() === "desc" ? (
              <ArrowDown className="ml-2 h-4 w-4" />
            ) : (
              <ArrowUpDown className="ml-2 h-4 w-4" />
            )}
          </Button>
        ),
        cell: ({ getValue, row }) => {
          const amount = getValue();
          const splitAmount = row.original.split_share_amount;
          return (
            <div className="text-right">
              <div className={cn(
                "font-semibold text-sm",
                row.original.direction === "debit" ? "text-red-600" : "text-green-600"
              )}>
                {formatCurrency(amount)}
              </div>
              {row.original.is_shared && splitAmount && splitAmount !== amount && (
                <div className="text-xs text-gray-500">
                  Your share: {formatCurrency(splitAmount)}
                </div>
              )}
            </div>
          );
        },
        size: 120,
      }),
      columnHelper.accessor("split_share_amount", {
        header: "Your Share",
        cell: ({ getValue, row }) => {
          const shareAmount = getValue();
          if (!row.original.is_shared) return null;
          return (
            <div className="text-right font-medium text-sm text-blue-600">
              {formatCurrency(shareAmount)}
            </div>
          );
        },
        size: 100,
      }),
      columnHelper.accessor("tags", {
        header: "Tags",
        cell: ({ getValue }) => {
          const tags = getValue();
          if (!tags || tags.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-1">
              {tags.slice(0, 2).map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs font-normal">
                  {tag}
                </Badge>
              ))}
              {tags.length > 2 && (
                <Badge variant="outline" className="text-xs font-normal">
                  +{tags.length - 2}
                </Badge>
              )}
            </div>
          );
        },
        size: 150,
      }),
      columnHelper.display({
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const transaction = row.original;
          return (
            <div className="flex items-center gap-1">
              {transaction.is_shared && (
                <Badge variant="outline" className="text-xs">
                  <Users className="h-3 w-3 mr-1" />
                  Shared
                </Badge>
              )}
              {transaction.is_refund && (
                <Badge variant="outline" className="text-xs">
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Refund
                </Badge>
              )}
              {transaction.is_transfer && (
                <Badge variant="outline" className="text-xs">
                  <Link className="h-3 w-3 mr-1" />
                  Transfer
                </Badge>
              )}
            </div>
          );
        },
        size: 120,
      }),
      columnHelper.display({
        id: "actions",
        header: "Actions",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedTransactionId(row.original.id);
                setIsEditModalOpen(true);
              }}
              title="Edit transaction"
            >
              <Edit3 className="h-4 w-4" />
            </Button>
            <Button 
              variant="ghost" 
              size="sm"
              title="Manage tags"
            >
              <Tag className="h-4 w-4" />
            </Button>
          </div>
        ),
        size: 100,
      }),
    ],
    [editingRow]
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
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            Transactions ({allTransactions.length} loaded{data?.pages?.[0]?.pagination?.total ? ` of ${data.pages[0].pagination.total}` : ''})
          </h3>
          {isFetchingNextPage && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              Loading more...
            </div>
          )}
        </div>
      </div>

      <div 
        className="overflow-auto relative" 
        ref={(node) => {
          parentRef.current = node;
          tableContainerRef.current = node;
        }}
        style={{ maxHeight: "70vh" }}
        onScroll={(e) => fetchMoreOnBottomReached(e.target as HTMLDivElement)}
      >
        <Table className="w-full table-fixed">
          <TableHeader className="sticky top-0 bg-white dark:bg-gray-900 z-30 border-b border-gray-200 dark:border-gray-700 shadow-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="px-3 py-3 text-left font-medium text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(
                  "hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800",
                  editingRow === row.original.id && "bg-blue-50 dark:bg-blue-900/20"
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="px-3 py-2 text-sm">
                    {flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext()
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
    </div>
  );
}
