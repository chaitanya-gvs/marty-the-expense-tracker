"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { Layers, ChevronDown, Loader2, X } from "lucide-react";
import { Users, Split, RefreshCw, Mail, AlertTriangle, ArrowLeftRight, FileText } from "lucide-react";
import { ActionTileGrid, type TransactionActionType } from "./action-tile-grid";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useCategoryColorMap } from "@/hooks/use-category-color-map";
import { useUpdateTransaction } from "@/hooks/use-transactions";
import { useTags } from "@/hooks/use-tags";
import { CategorySelector } from "./category-selector";
import { MultiTagSelector } from "./multi-tag-selector";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TransactionDetailsDrawerProps {
    transaction: Transaction | null;
    isOpen: boolean;
    onClose: () => void;
    onUngroupExpense?: (transaction: Transaction) => Promise<void>;
    initialMode?: "view" | "edit";
    onAction: (type: TransactionActionType, transaction: Transaction) => void;
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

// Splits a list of tag names into the Tag objects that could be resolved
// against the loaded tag list, and the names that could not be (because
// allTags hasn't loaded yet, or hasn't picked up a just-created tag yet).
// Shared by the reset effect, the late-hydration effect, and handleCancel
// so there's a single place that defines what "this transaction's tags"
// means at any given moment.
function splitTags(names: string[] | undefined, allTags: Tag[]): { resolved: Tag[]; unresolved: string[] } {
    if (!names || names.length === 0) {
        return { resolved: [], unresolved: [] };
    }
    const resolved: Tag[] = [];
    const unresolved: string[] = [];
    for (const name of names) {
        const tag = allTags.find((t) => t.name === name);
        if (tag) {
            resolved.push(tag);
        } else {
            unresolved.push(name);
        }
    }
    return { resolved, unresolved };
}

// Stable empty-array reference for allTags while the tags query is pending
// (or has no data). useTags() would otherwise default to a fresh `[]` on
// every render, which — as a dependency of the hydration effect below —
// would make that effect re-fire every render until the query settles.
const EMPTY_TAGS: Tag[] = [];

// Dedupes names across multiple lists, preserving first-seen order.
function uniqueNames(...lists: string[][]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const list of lists) {
        for (const name of list) {
            if (!seen.has(name)) {
                seen.add(name);
                result.push(name);
            }
        }
    }
    return result;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">{label}</Label>
            {children}
        </div>
    );
}

export function TransactionDetailsDrawer({
    transaction,
    isOpen,
    onClose,
    onUngroupExpense,
    initialMode = "view",
    onAction,
}: TransactionDetailsDrawerProps) {
    const isMobile = useIsMobile();
    const categoryColorMap = useCategoryColorMap();
    const updateTransaction = useUpdateTransaction();
    const { data: tagsData } = useTags();
    const allTags = tagsData ?? EMPTY_TAGS;

    const [mode, setMode] = useState<"view" | "edit">(initialMode);
    const [form, setForm] = useState<EditFormState | null>(null);
    const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
    // Names on the transaction that couldn't be resolved against allTags yet
    // (when allTags is empty, this is ALL of transaction.tags). Never shown
    // as editable chips, but preserved on Save and surfaced to the user so
    // nothing silently disappears while tags load.
    const [unresolvedTagNames, setUnresolvedTagNames] = useState<string[]>([]);
    const [advancedOpen, setAdvancedOpen] = useState(false);

    // Mirrors unresolvedTagNames for the late-hydration effect below, so
    // that effect's deps can stay [allTags] — it always reads the latest
    // buffer without needing unresolvedTagNames itself in the dep array.
    const unresolvedRef = useRef<string[]>(unresolvedTagNames);
    unresolvedRef.current = unresolvedTagNames;

    // Mirrors `mode` for the re-sync effect below, so that effect can check
    // the current mode without adding `mode` to its own deps (which would
    // make it re-fire on every view/edit toggle, not just on direction/amount
    // changes).
    const modeRef = useRef(mode);
    modeRef.current = mode;

    // Reset local edit state whenever a different transaction is opened, or
    // the drawer is asked to open directly into edit mode (from the
    // quick-actions panel's Edit tile). Deliberately does NOT depend on
    // allTags — MultiTagSelector's useCreateTag() invalidates the ["tags"]
    // query on every new tag, and if allTags were a dep here this effect
    // would re-fire mid-edit and reset mode/form, discarding unsaved changes.
    // Late tag hydration (once allTags resolves) is handled by the second
    // effect below instead.
    useEffect(() => {
        if (!transaction) return;
        setMode(isOpen ? initialMode : "view");
        setForm(toFormState(transaction));
        const { resolved, unresolved } = splitTags(transaction.tags, allTags);
        setSelectedTags(resolved);
        setUnresolvedTagNames(unresolved);
        setAdvancedOpen(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transaction?.id, isOpen, initialMode]);

    // Late tag hydration: whenever allTags resolves or refetches (initial
    // load still in flight, or a tag query invalidation while the drawer is
    // open — e.g. the user creates a new tag mid-edit), try to resolve any
    // still-unresolved names and MERGE the newly-resolved ones into the
    // current selectedTags buffer. Never replaces the buffer, never touches
    // mode/form, and runs in any mode — including edit — since merging can
    // only add tags the user already had, never drop or overwrite ones
    // they're actively editing.
    useEffect(() => {
        if (unresolvedRef.current.length === 0) return;
        const { resolved, unresolved } = splitTags(unresolvedRef.current, allTags);
        // Nothing newly resolved (allTags is still EMPTY_TAGS, or none of the
        // still-unresolved names matched) — skip the setState calls entirely
        // so this doesn't create new array references and re-trigger itself.
        if (resolved.length === 0) return;
        setSelectedTags((prev) => [
            ...prev,
            ...resolved.filter((t) => !prev.some((p) => p.id === t.id)),
        ]);
        setUnresolvedTagNames(unresolved);
    }, [allTags]);

    // Re-sync direction/amount into the edit buffer when a card-list action
    // (Flag/Swap ±) mutates the transaction in place while the drawer stays
    // open. Only in view mode — an in-progress edit buffer must never be
    // clobbered by a live update (C4).
    useEffect(() => {
        if (modeRef.current !== "view") return;
        setForm((f) => (f ? { ...f, direction: transaction?.direction ?? f.direction, amount: transaction?.amount ?? f.amount } : f));
    }, [transaction?.direction, transaction?.amount]);

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
                    // Always send tags: resolved names reflect the user's edits
                    // (including a deliberate clear to [] when nothing is
                    // unresolved), while unresolved names — tags the user never
                    // saw as editable chips because allTags hadn't hydrated yet —
                    // are carried through untouched so they can't be lost.
                    tags: uniqueNames(selectedTags.map((t) => t.name), unresolvedTagNames),
                },
            });
            toast.success("Transaction updated");
            setMode("view");
        } catch {
            toast.error("Failed to update transaction");
        }
    };

    // View mode renders editable fields straight from form/selectedTags
    // (deliberate — Slice 1's stale-post-save fix), so simply switching back
    // to view mode would leave unsaved edits looking committed. Reset the
    // edit buffer back to the transaction's actual persisted state first.
    const handleCancel = () => {
        setForm(toFormState(transaction));
        const { resolved, unresolved } = splitTags(transaction.tags, allTags);
        setSelectedTags(resolved);
        setUnresolvedTagNames(unresolved);
        setAdvancedOpen(false);
        setMode("view");
    };

    return (
        <Sheet open={isOpen} onOpenChange={onClose}>
            <SheetContent
                side={isMobile ? "bottom" : "right"}
                className="w-full sm:w-[540px] overflow-y-auto"
            >
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
                                {/* Reads transaction.* directly (not form.*) so this reflects a
                                    Flag/Swap ± mutation immediately — form only re-derives when
                                    transaction.id changes, but the drawer's transaction prop is
                                    now reactive to live cache updates (I2). */}
                                <span className={`text-xl font-semibold ${transaction.direction === 'debit' ? 'text-destructive' : 'text-emerald-500'
                                    }`}>
                                    {transaction.direction === 'debit' ? '-' : '+'}{formatCurrency(transaction.amount)}
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

                        {(selectedTags.length > 0 || unresolvedTagNames.length > 0) && (
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground mb-2">Tags</h3>
                                <div className="flex flex-wrap gap-2">
                                    {selectedTags.map(tag => (
                                        <Badge key={tag.id} variant="secondary">{tag.name}</Badge>
                                    ))}
                                    {unresolvedTagNames.map(name => (
                                        <Badge key={name} variant="secondary">{name}</Badge>
                                    ))}
                                </div>
                            </div>
                        )}

                        <Separator />

                        <Button className="w-full" onClick={() => setMode("edit")}>
                            Edit
                        </Button>

                        <ActionTileGrid
                            tiles={[
                                { key: "shared", label: "Shared", icon: Users, active: transaction.is_shared, onClick: () => onAction("shared", transaction) },
                                { key: "group", label: "Group", icon: Layers, active: !!transaction.transaction_group_id, onClick: () => onAction("group", transaction) },
                                { key: "split", label: "Split", icon: Split, active: transaction.is_split, onClick: () => onAction("split", transaction) },
                                { key: "recurring", label: "Recurring", icon: RefreshCw, active: transaction.is_recurring === true, onClick: () => onAction("recurring", transaction) },
                                { key: "links", label: "Links", icon: Mail, active: !!(transaction.related_mails && transaction.related_mails.length > 0), onClick: () => onAction("links", transaction) },
                                { key: "flag", label: "Flag", icon: AlertTriangle, active: transaction.is_flagged === true, onClick: () => onAction("flag", transaction) },
                                { key: "direction", label: "Swap ±", icon: ArrowLeftRight, onClick: () => onAction("direction", transaction) },
                                { key: "pdf", label: "PDF", icon: FileText, disabled: !transaction.source_file, onClick: () => onAction("pdf", transaction) },
                            ]}
                            onDelete={() => onAction("delete", transaction)}
                        />

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
                        <Field label="Description">
                            <Input
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                className="h-11 text-base"
                            />
                        </Field>

                        <Field label="Category">
                            <CategorySelector
                                value={form.category}
                                onValueChange={(value) => setForm({ ...form, category: value })}
                                transactionDirection={form.direction}
                            />
                        </Field>

                        <Field label="Tags">
                            <MultiTagSelector
                                selectedTags={selectedTags}
                                onTagsChange={setSelectedTags}
                            />
                            {unresolvedTagNames.length > 0 && (
                                <div className="mt-1.5">
                                    <p className="text-xs text-muted-foreground mb-1">
                                        {unresolvedTagNames.length} tag{unresolvedTagNames.length === 1 ? "" : "s"} will be kept:
                                    </p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {unresolvedTagNames.map((name) => (
                                            <span
                                                key={name}
                                                className="inline-flex items-center gap-1 min-h-7 pl-2 pr-1 rounded-full bg-muted text-muted-foreground text-xs"
                                            >
                                                {name}
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setUnresolvedTagNames((prev) => prev.filter((n) => n !== name))
                                                    }
                                                    className="rounded-full p-0.5 hover:bg-background/60"
                                                    aria-label={`Remove tag ${name}`}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </Field>

                        <Field label="Notes">
                            <Textarea
                                value={form.notes}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                placeholder="Add a note…"
                                rows={3}
                                className="text-base"
                            />
                        </Field>

                        <button
                            type="button"
                            onClick={() => setAdvancedOpen(!advancedOpen)}
                            className="w-full min-h-11 flex items-center justify-between py-2.5 border-t border-border text-xs font-semibold text-muted-foreground"
                        >
                            <span>Advanced (date, account, amount, flags)</span>
                            <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} />
                        </button>

                        {advancedOpen && (
                            <div className="space-y-4 pt-1">
                                <Field label="Date">
                                    <Input
                                        type="date"
                                        value={form.date}
                                        onChange={(e) => setForm({ ...form, date: e.target.value })}
                                        className="h-11 text-base"
                                    />
                                </Field>
                                <Field label="Account">
                                    <Input
                                        value={form.account}
                                        onChange={(e) => setForm({ ...form, account: e.target.value })}
                                        className="h-11 text-base"
                                    />
                                </Field>
                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Direction">
                                        <Select
                                            value={form.direction}
                                            onValueChange={(value) => setForm({ ...form, direction: value as "debit" | "credit" })}
                                        >
                                            <SelectTrigger className="h-11 text-base">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="debit">Debit (money out)</SelectItem>
                                                <SelectItem value="credit">Credit (money in)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Field label="Amount">
                                        <Input
                                            type="number"
                                            inputMode="decimal"
                                            step="0.01"
                                            value={form.amount}
                                            onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                                            className="h-11 text-base font-mono tabular-nums"
                                        />
                                    </Field>
                                </div>
                                <div className="divide-y divide-border rounded-md border border-border">
                                    <label className="flex items-center justify-between min-h-11 px-3 text-sm">
                                        <span>Shared</span>
                                        <Switch checked={form.is_shared} onCheckedChange={(checked) => setForm({ ...form, is_shared: checked })} />
                                    </label>
                                    <label className="flex items-center justify-between min-h-11 px-3 text-sm">
                                        <span>Refund</span>
                                        <Switch checked={form.is_refund} onCheckedChange={(checked) => setForm({ ...form, is_refund: checked })} />
                                    </label>
                                    <label className="flex items-center justify-between min-h-11 px-3 text-sm">
                                        <span>Transfer</span>
                                        <Switch checked={form.is_transfer} onCheckedChange={(checked) => setForm({ ...form, is_transfer: checked })} />
                                    </label>
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" className="flex-1 h-11" onClick={handleCancel} disabled={updateTransaction.isPending}>
                                Cancel
                            </Button>
                            <Button className="flex-1 h-11" onClick={handleSave} disabled={updateTransaction.isPending}>
                                {updateTransaction.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                            </Button>
                        </div>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
