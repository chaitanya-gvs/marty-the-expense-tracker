
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Transaction } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Layers } from "lucide-react";

interface TransactionDetailsDrawerProps {
    transaction: Transaction | null;
    isOpen: boolean;
    onClose: () => void;
    onUngroupExpense?: (transaction: Transaction) => Promise<void>;
}

export function TransactionDetailsDrawer({
    transaction,
    isOpen,
    onClose,
    onUngroupExpense,
}: TransactionDetailsDrawerProps) {
    if (!transaction) return null;

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>Transaction Details</SheetTitle>
                    <SheetDescription>
                        View detailed information about this transaction.
                    </SheetDescription>
                </SheetHeader>

                <div className="mt-6 space-y-6">
                    {/* Header Section */}
                    <div className="flex flex-col gap-2">
                        <h2 className="text-2xl font-bold">{transaction.description}</h2>
                        <div className="flex items-center gap-2">
                            <span className={`text-xl font-semibold ${transaction.direction === 'debit' ? 'text-red-500' : 'text-green-500'
                                }`}>
                                {transaction.direction === 'debit' ? '-' : '+'}{formatCurrency(transaction.amount)}
                            </span>
                            <Badge variant="outline">{transaction.account}</Badge>
                        </div>
                    </div>

                    <Separator />

                    {/* Details Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-sm font-medium text-slate-500">Date</p>
                            <p>{formatDate(transaction.date)}</p>
                        </div>
                        <div>
                            <p className="text-sm font-medium text-slate-500">Category</p>
                            <p>{transaction.category || "Uncategorized"}</p>
                        </div>
                        {transaction.subcategory && (
                            <div>
                                <p className="text-sm font-medium text-slate-500">Subcategory</p>
                                <p>{transaction.subcategory}</p>
                            </div>
                        )}
                        <div>
                            <p className="text-sm font-medium text-slate-500">Status</p>
                            <div className="flex gap-1 mt-1 flex-wrap">
                                {transaction.is_flagged && <Badge variant="destructive">Flagged</Badge>}
                                {transaction.is_shared && <Badge variant="secondary">Shared</Badge>}
                                {transaction.is_split && <Badge variant="secondary">Split</Badge>}
                                {transaction.is_grouped_expense && (
                                    <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950/20 border-purple-300 dark:border-purple-700">
                                        <Layers className="h-3 w-3 mr-1" />
                                        Grouped
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>

                    <Separator />

                    {/* Grouped Expense Info */}
                    {transaction.is_grouped_expense && (
                        <div className="rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 p-4">
                            <div className="flex items-start gap-2">
                                <Layers className="h-5 w-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                                <div className="flex-1">
                                    <h3 className="text-sm font-semibold text-purple-900 dark:text-purple-100 mb-1">
                                        Grouped Expense
                                    </h3>
                                    <p className="text-xs text-purple-800 dark:text-purple-200">
                                        This transaction represents multiple transactions combined into a single net amount.
                                        The amount shown is the algebraic sum of all credits (positive) and debits (negative)
                                        in the group.
                                    </p>
                                    {transaction.transaction_group_id && (
                                        <p className="text-xs text-purple-700 dark:text-purple-300 mt-2 font-mono">
                                            Group ID: {transaction.transaction_group_id.slice(0, 8)}...
                                        </p>
                                    )}
                                    
                                    {/* Ungroup button */}
                                    {onUngroupExpense && (
                                        <button
                                            onClick={async () => {
                                                await onUngroupExpense(transaction);
                                                onClose();
                                            }}
                                            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-purple-700 dark:text-purple-300 bg-white dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/50 transition-colors"
                                        >
                                            <Layers className="h-4 w-4" />
                                            Ungroup Expense
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Notes */}
                    {transaction.notes && (
                        <div>
                            <h3 className="text-sm font-medium text-slate-500 mb-1">Notes</h3>
                            <p className="text-sm bg-slate-50 dark:bg-slate-900 p-3 rounded-md">
                                {transaction.notes}
                            </p>
                        </div>
                    )}

                    {/* Tags */}
                    {transaction.tags && transaction.tags.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-slate-500 mb-2">Tags</h3>
                            <div className="flex flex-wrap gap-2">
                                {transaction.tags.map(tag => (
                                    <Badge key={tag} variant="secondary">{tag}</Badge>
                                ))}
                            </div>
                        </div>
                    )}

                    <Separator />

                    {/* Raw Data (Debug) */}
                    <div>
                        <h3 className="text-sm font-medium text-slate-500 mb-2">Raw Data (Debug)</h3>
                        <pre className="bg-slate-950 text-slate-50 text-xs p-4 rounded-md overflow-x-auto">
                            {JSON.stringify(transaction, null, 2)}
                        </pre>
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
