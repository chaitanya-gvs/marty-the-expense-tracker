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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useInfiniteTransactions } from "@/hooks/use-transactions";
import { Transaction, TransactionFilters, TransactionSort } from "@/lib/types";
import { cn } from "@/lib/utils";
import { 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  Tag, 
  Users,
  Edit3,
  CreditCard,
  Wallet,
  Calendar,
  ShoppingCart,
  DollarSign,
  Building2,
  MoreHorizontal,
  Link2,
  GitBranch
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


// Helper function to get category colors
const getCategoryColor = (category: string) => {
  const cat = category.toLowerCase();
  if (cat.includes('food') || cat.includes('restaurant') || cat.includes('grocery')) {
    return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-700';
  }
  if (cat.includes('travel') || cat.includes('transport')) {
    return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700';
  }
  if (cat.includes('medical') || cat.includes('health')) {
    return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700';
  }
  if (cat.includes('entertainment')) {
    return 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-700';
  }
  if (cat.includes('shopping')) {
    return 'bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900/20 dark:text-pink-300 dark:border-pink-700';
  }
  return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/20 dark:text-gray-300 dark:border-gray-700';
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
          return formatDate(getValue());
        },
        size: 80,
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
          
          return (
            <div 
              className="max-w-[300px] cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-2 rounded"
              onClick={() => {
                setEditingRow(row.original.id);
                setEditingField("description");
              }}
            >
              <div className="font-medium text-sm truncate">
                {getValue()}
              </div>
              {row.original.notes && (
                <div className="text-xs text-gray-500 truncate">
                  {row.original.notes}
                </div>
              )}
            </div>
          );
        },
        size: 500,
      }),
      
      // Amount column with color coding
      columnHelper.accessor("amount", {
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-2 gap-1 text-sm font-medium"
          >
            <DollarSign className="h-4 w-4" />
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
        cell: ({ getValue, row }) => {
          const amount = getValue();
          const splitAmount = row.original.split_share_amount;
          const direction = row.original.direction;
          
           return (
             <div className="flex flex-col items-center">
               <div className={cn(
                 "font-semibold text-sm inline-flex items-center px-3 py-1 rounded-full w-fit",
                 direction === "debit" 
                   ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" 
                   : "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
               )}>
                 {direction === "debit" ? "↓" : "↑"} {formatCurrency(amount)}
               </div>
               {row.original.is_shared && splitAmount && splitAmount !== amount && (
                 <div className="text-xs text-gray-500 mt-1 text-center">
                   Your share: {formatCurrency(splitAmount)}
                 </div>
               )}
             </div>
           );
        },
        size: 100,
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
          const { processedName, icon, isCreditCard } = processAccountInfo(getValue());
          return (
             <Badge 
               variant="outline" 
               className={cn(
                 "text-xs font-medium flex items-center",
                 isCreditCard 
                   ? "border-blue-500 text-blue-700 bg-blue-50 dark:border-blue-400 dark:text-blue-300 dark:bg-blue-900/20" 
                   : "border-green-500 text-green-700 bg-green-50 dark:border-green-400 dark:text-green-300 dark:bg-green-900/20"
               )}
             >
              {icon}
              {processedName}
            </Badge>
          );
        },
        size: 100,
      }),
      
      // Category column (moved after amount)
      columnHelper.accessor("category", {
        header: () => (
          <div className="flex items-center gap-1 text-sm font-medium">
            <Tag className="h-4 w-4" />
            Category
          </div>
        ),
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
              <Badge 
                variant="outline" 
                className={cn("text-xs font-medium", getCategoryColor(getValue()))}
              >
                {getValue()}
              </Badge>
              {row.original.subcategory && (
                <div className="text-xs text-gray-500 mt-1">
                  {row.original.subcategory}
                </div>
              )}
            </div>
          );
        },
        size: 100,
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
             <div className="flex justify-center">
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
                   // TODO: Implement overlay functionality for shared transactions
                   console.log("Toggle shared for transaction:", transaction.id, "Current state:", transaction.is_shared);
                 }}
                 title={transaction.is_shared ? "Mark as personal" : "Mark as shared"}
               >
                 <Users className="h-4 w-4" />
               </Button>
             </div>
           );
         },
         size: 70,
       }),
       
       // Actions column
      columnHelper.display({
        id: "actions",
        header: () => (
          <div className="flex items-center justify-center gap-1 text-sm font-medium">
            <MoreHorizontal className="h-4 w-4" />
            Actions
          </div>
        ),
        cell: ({ row }) => {
          const transaction = row.original;
          return (
            <div className="flex justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                    <MoreHorizontal className="h-4 w-4" />
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
                  <DropdownMenuItem>
                    <Tag className="h-4 w-4 mr-2" />
                    Tag
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Link2 className="h-4 w-4 mr-2" />
                    Link refund
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <GitBranch className="h-4 w-4 mr-2" />
                    Group transfer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
        size: 70,
      }),
    ],
    [editingRow, editingField]
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
        style={{ maxHeight: "70vh", width: "100%", minWidth: "1000px" }}
        onScroll={(e) => fetchMoreOnBottomReached(e.target as HTMLDivElement)}
      >
        <Table className="w-full" style={{ tableLayout: 'fixed' }}>
          <TableHeader className="sticky top-0 bg-white dark:bg-gray-900 z-30 border-b border-gray-200 dark:border-gray-700 shadow-sm">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead 
                    key={header.id} 
                    className="px-2 py-2 text-left font-medium text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900"
                    style={{ width: `${header.getSize()}px` }}
                  >
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
                  <TableCell 
                    key={cell.id} 
                    className="px-2 py-1 text-sm"
                    style={{ width: `${cell.column.getSize()}px` }}
                  >
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
