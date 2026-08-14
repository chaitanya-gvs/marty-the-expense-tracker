"use client";

import { useEffect, useState } from "react";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Transaction, Tag } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Layers, ChevronDown, Loader2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useCategoryColorMap } from "@/hooks/use-category-color-map";
import { useUpdateTransaction } from "@/hooks/use-transactions";
import { useTags } from "@/hooks/use-tags";
import { CategorySelector } from "./category-selector";
import { MultiTagSelector } from "./multi-tag-selector";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TransactionDetailsDrawerProps {
    transaction: Transaction | null;
    isOpen: boolean;
    onClose: () => void;
    onUngroupExpense?: (transaction: Transaction) => Promise<void>;
    initialMode?: "view" | "edit";
}

interface EditFormState {
    description: string;
    category: string;
    notes: string;
    date: string;
    account: string;
    direction: "debit" | "credit";
    amount: number;
    split_share_amount: number;
    is_shared: boolean;
    is_refund: boolean;
    is_transfer: boolean;
}

function toFormState(t: Transaction): EditFormState {
    return {
        description: t.description,
        category: t.category,
        notes: t.notes ?? "",
        date: t.date,
        account: t.account,
        direction: t.direction,
        amount: t.amount,
        split_share_amount: t.split_share_amount,
        is_shared: t.is_shared,
        is_refund: t.is_refund,
        is_transfer: t.is_transfer,
    };
}

export function TransactionDetailsDrawer({
    transaction,
    isOpen,
    onClose,
    onUngroupExpense,
    initialMode = "view",
}: TransactionDetailsDrawerProps) {
    const isMobile = useIsMobile();
    const categoryColorMap = useCategoryColorMap();
    const updateTransaction = useUpdateTransaction();
    const { data: allTags = [] } = useTags();

    const [mode, setMode] = useState<"view" | "edit">(initialMode);
    const [form, setForm] = useState<EditFormState | null>(null);
    const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
    const [advancedOpen, setAdvancedOpen] = useState(false);

    // Reset local edit state whenever a different transaction is opened, or
    // the drawer is asked to open directly into edit mode (from the
    // quick-actions panel's Edit tile).
    useEffect(() => {
        if (!transaction) return;
        setMode(isOpen ? initialMode : "view");
        setForm(toFormState(transaction));
        const tagObjects = (transaction.tags || [])
            .map((name) => allTags.find((tag) => tag.name === name))
            .filter((tag): tag is Tag => tag !== undefined);
        setSelectedTags(tagObjects);
        setAdvancedOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transaction?.id, isOpen, initialMode]);

    if (!transaction || !form) return null;

    const categoryColor = categoryColorMap[form.category];

    const handleSave = async () => {
        try {
            await updateTransaction.mutateAsync({
                id: transaction.id,
                updates: {
                    description: form.description,
                    category: form.category,
                    notes: form.notes || undefined,
                    date: form.date,
                    account: form.account,
                    direction: form.direction,
                    amount: form.amount,
                    split_share_amount: form.split_share_amount,
                    is_shared: form.is_shared,
                    is_refund: form.is_refund,
                    is_transfer: form.is_transfer,
                    tags: selectedTags.map((t) => t.name),
                },
            });
            toast.success("Transaction updated");
            setMode("view");
        } catch {
            toast.error("Failed to update transaction");
        }
    };

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent
                side={isMobile ? "bottom" : "right"}
                className={cn(
                    "w-full sm:w-[540px] overflow-y-auto",
                    isMobile && "max-h-[90vh] rounded-t-xl"
                )}
            >
                {isMobile && (
                    <div className="w-9 h-1 rounded-full bg-border mx-auto mb-3" />
                )}
                <SheetHeader>
                    <SheetTitle>{mode === "edit" ? "Edit Transaction" : "Transaction Details"}</SheetTitle>
                    <SheetDescription>
                        {mode === "edit"
                            ? "Update this transaction's details."
                            : "View detailed information about this transaction."}
                    </SheetDescription>
                </SheetHeader>

                {mode === "view" ? (
                    <div className="mt-6 space-y-6">
                        <div className="flex flex-col gap-2">
                            <h2 className="text-2xl font-bold">{form.description}</h2>
                            <div className="flex items-center gap-2">
                                <span className={`text-xl font-semibold ${form.direction === 'debit' ? 'text-destructive' : 'text-emerald-500'
                                    }`}>
                                    {form.direction === 'debit' ? '-' : '+'}{formatCurrency(form.amount)}
                                </span>
                                <Badge variant="outline">{form.account}</Badge>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span
                                    className="h-2 w-2 rounded-full shrink-0"
                                    style={{ backgroundColor: categoryColor ?? "var(--muted-foreground)" }}
                                />
                                <span className="text-sm text-muted-foreground">{form.category || "Uncategorized"}</span>
                            </div>
                        </div>

                        <Separator />

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">Date</p>
                                <p>{formatDate(form.date)}</p>
                            </div>
                            {transaction.subcategory && (
                                <div>
                                    <p className="text-sm font-medium text-muted-foreground">Subcategory</p>
                                    <p>{transaction.subcategory}</p>
                                </div>
                            )}
                            <div>
                                <p className="text-sm font-medium text-muted-foreground">Status</p>
                                <div className="flex gap-1 mt-1 flex-wrap">
                                    {transaction.is_flagged && <Badge variant="destructive">Flagged</Badge>}
                                    {form.is_shared && <Badge variant="secondary">Shared</Badge>}
                                    {transaction.is_split && <Badge variant="secondary">Split</Badge>}
                                    {transaction.is_grouped_expense && (
                                        <Badge variant="outline" className="bg-primary/10 border-primary/30">
                                            <Layers className="h-3 w-3 mr-1" />
                                            Grouped
                                        </Badge>
                                    )}
                                </div>
                            </div>
                        </div>

                        {selectedTags.length > 0 && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground mb-2">Tags</h3>
                                <div className="flex flex-wrap gap-2">
                                    {selectedTags.map(tag => (
                                        <Badge key={tag.id} variant="secondary">{tag.name}</Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        <Separator />

                        <Button className="w-full" onClick={() => setMode("edit")}>
                            Edit
                        </Button>

                        {transaction.is_grouped_expense && (
                            <div className="rounded-lg bg-primary/10 border border-primary/20 p-4">
                                <div className="flex items-start gap-2">
                                    <Layers className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                                    <div className="flex-1">
                                        <h3 className="text-sm font-semibold text-primary mb-1">
                                            Grouped Expense
                                        </h3>
                                        <p className="text-xs text-primary/80">
                                            This transaction represents multiple transactions combined into a single net amount.
                                            The amount shown is the algebraic sum of all credits (positive) and debits (negative)
                                            in the group.
                                        </p>
                                        {transaction.transaction_group_id && (
                                            <p className="text-xs text-primary/70 mt-2 font-mono">
                                                Group ID: {transaction.transaction_group_id.slice(0, 8)}...
                                            </p>
                                        )}

                                        {onUngroupExpense && (
                                            <button
                                                onClick={async () => {
                                                    await onUngroupExpense(transaction);
                                                    onClose();
                                                }}
                                                className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-destructive bg-destructive/10 border border-destructive/30 rounded-md hover:bg-destructive/15 transition-colors"
                                            >
                                                <Layers className="h-4 w-4" />
                                                Ungroup Expense
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {form.notes && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground mb-1">Notes</h3>
                                <p className="text-sm bg-slate-50 dark:bg-slate-900 p-3 rounded-md">
                                    {form.notes}
                                </p>
                            </div>
                        )}

                        {process.env.NEXT_PUBLIC_APP_ENV === 'development' && (
                            <details className="mt-4">
                                <summary className="text-xs text-muted-foreground/40 cursor-pointer select-none">
                                    Raw data (dev only)
                                </summary>
                                <pre className="mt-2 bg-muted text-muted-foreground text-[10px] p-3 rounded-md overflow-x-auto leading-relaxed">
                                    {JSON.stringify(transaction, null, 2)}
                                </pre>
                            </details>
                        )}
                    </div>
                ) : (
                    <div className="mt-6 space-y-4">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Description</label>
                            <input
                                type="text"
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                className="w-full h-10 px-3 rounded-md bg-muted border border-border text-sm"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Category</label>
                            <CategorySelector
                                value={form.category}
                                onValueChange={(value) => setForm({ ...form, category: value })}
                                transactionDirection={form.direction}
                            />
                        </div>

                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Tags</label>
                            <MultiTagSelector selectedTags={selectedTags} onTagsChange={setSelectedTags} />
                        </div>

                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Notes</label>
                            <Textarea
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                placeholder="Add a note…"
                                rows={3}
                            />
                        </div>

                        <button
                            type="button"
                            onClick={() => setAdvancedOpen(!advancedOpen)}
                            className="w-full flex items-center justify-between py-2.5 border-t border-border text-xs font-semibold text-muted-foreground"
                        >
                            <span>Advanced (date, account, amount, flags)</span>
                            <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
                        </button>

                        {advancedOpen && (
                            <div className="space-y-4 pt-1">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Date</label>
                                        <input
                                            type="date"
                                            value={form.date}
                                            onChange={(e) => setForm({ ...form, date: e.target.value })}
                                            className="w-full h-10 px-3 rounded-md bg-muted border border-border text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Account</label>
                                        <input
                                            type="text"
                                            value={form.account}
                                            onChange={(e) => setForm({ ...form, account: e.target.value })}
                                            className="w-full h-10 px-3 rounded-md bg-muted border border-border text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Direction</label>
                                        <select
                                            value={form.direction}
                                            onChange={(e) => setForm({ ...form, direction: e.target.value as "debit" | "credit" })}
                                            className="w-full h-10 px-3 rounded-md bg-muted border border-border text-sm"
                                        >
                                            <option value="debit">Debit (money out)</option>
                                            <option value="credit">Credit (money in)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Amount</label>
                                        <input
                                            type="number"
                                            value={form.amount}
                                            onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                                            className="w-full h-10 px-3 rounded-md bg-muted border border-border text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-4">
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={form.is_shared} onChange={(e) => setForm({ ...form, is_shared: e.target.checked })} />
                                        Shared
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={form.is_refund} onChange={(e) => setForm({ ...form, is_refund: e.target.checked })} />
                                        Refund
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                        <input type="checkbox" checked={form.is_transfer} onChange={(e) => setForm({ ...form, is_transfer: e.target.checked })} />
                                        Transfer
                                    </label>
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" className="flex-1" onClick={() => setMode("view")} disabled={updateTransaction.isPending}>
                                Cancel
                            </Button>
                            <Button className="flex-1" onClick={handleSave} disabled={updateTransaction.isPending}>
                                {updateTransaction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                            </Button>
                        </div>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
