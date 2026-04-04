"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, Calculator, Users, Check, CheckCircle2, Trash2 } from "lucide-react";
import { Transaction, SplitBreakdown, SplitEntry } from "@/lib/types";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { useParticipants } from "@/hooks/use-participants";
import { cn } from "@/lib/utils";

interface SplitEditorProps {
  transaction: Transaction;
  isOpen: boolean;
  isLoading?: boolean;
  onClose: () => void;
  onSave: (splitBreakdown: SplitBreakdown, myShareAmount: number) => void;
  onClearSplit?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toTitleCase(s: string) {
  return s.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// ── Avatar helpers ────────────────────────────────────────────────────────────

const PARTICIPANT_COLORS = [
  { bg: "bg-violet-500/20", text: "text-violet-300", border: "border-violet-500/30" },
  { bg: "bg-blue-500/20",   text: "text-blue-300",   border: "border-blue-500/30"   },
  { bg: "bg-emerald-500/20",text: "text-emerald-300",border: "border-emerald-500/30"},
  { bg: "bg-amber-500/20",  text: "text-amber-300",  border: "border-amber-500/30"  },
  { bg: "bg-rose-500/20",   text: "text-rose-300",   border: "border-rose-500/30"   },
  { bg: "bg-cyan-500/20",   text: "text-cyan-300",   border: "border-cyan-500/30"   },
];

function getParticipantColor(name: string) {
  if (name === "me") return { bg: "bg-primary/20", text: "text-primary", border: "border-primary/30" };
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i)) % PARTICIPANT_COLORS.length;
  return PARTICIPANT_COLORS[hash];
}

function getInitials(name: string) {
  if (name === "me") return "ME";
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function ParticipantAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const color = getParticipantColor(name);
  return (
    <div className={cn(
      "rounded-full flex items-center justify-center font-bold flex-shrink-0 border",
      color.bg, color.text, color.border,
      size === "sm" ? "w-7 h-7 text-[9px] tracking-wide" : "w-8 h-8 text-[10px] tracking-wide"
    )}>
      {getInitials(name)}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SharedExpenseEditor({ transaction, isOpen, isLoading = false, onClose, onSave, onClearSplit }: SplitEditorProps) {
  const [mode, setMode] = useState<"equal" | "custom">("equal");
  const [includeMe, setIncludeMe] = useState(true);
  const [entries, setEntries] = useState<SplitEntry[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [paidBy, setPaidBy] = useState<string>("me");
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { participants: allParticipants } = useParticipants();

  // All non-"me" participants, filtered by search
  const filteredParticipants = allParticipants.filter(
    p => p.name !== "me" && p.name.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    if (transaction.split_breakdown) {
      setMode(transaction.split_breakdown.mode);
      setIncludeMe(transaction.split_breakdown.include_me);
      setEntries(transaction.split_breakdown.entries);
      setPaidBy(transaction.split_breakdown.paid_by || "me");
      const participantNames = transaction.split_breakdown.entries
        .filter(e => e.participant !== "me")
        .map(e => e.participant);
      setSelectedParticipants(participantNames);
    } else {
      setMode("equal");
      setIncludeMe(true);
      setEntries([{ participant: "me", amount: null }]);
      setPaidBy(transaction.paid_by || "me");
      setSelectedParticipants([]);
    }
  }, [transaction]);

  useEffect(() => {
    setEntries(currentEntries => {
      if (includeMe) {
        const hasMe = currentEntries.some(entry => entry.participant === "me");
        if (!hasMe) {
          return [{ participant: "me", amount: mode === "custom" ? 0 : null }, ...currentEntries];
        }
        return currentEntries;
      } else {
        return currentEntries.filter(entry => entry.participant !== "me");
      }
    });
  }, [includeMe, mode]);

  const addParticipants = (participantNames: string[]) => {
    setEntries(currentEntries => {
      const meEntry = currentEntries.find(e => e.participant === "me");
      const keepMe = includeMe && meEntry ? [meEntry] : [];
      const existingEntries = currentEntries.filter(
        e => e.participant !== "me" && participantNames.includes(e.participant)
      );
      const newParticipantNames = participantNames.filter(
        name => !currentEntries.some(e => e.participant === name)
      );
      const newEntries = newParticipantNames.map(name => ({
        participant: name,
        amount: mode === "custom" ? 0 : null,
      }));
      return [...keepMe, ...existingEntries, ...newEntries];
    });
  };

  const removeParticipant = (index: number) => {
    const removedEntry = entries[index];
    setEntries(entries.filter((_, i) => i !== index));
    if (removedEntry.participant !== "me") {
      setSelectedParticipants(selectedParticipants.filter(p => p !== removedEntry.participant));
    }
  };

  const updateParticipantAmount = (index: number, amount: number | null) => {
    const newEntries = [...entries];
    newEntries[index].amount = amount;
    setEntries(newEntries);
  };

  const calculateEqualSplit = () => {
    if (mode === "equal" && entries.length > 0) {
      return (transaction.net_amount ?? transaction.amount) / entries.length;
    }
    return 0;
  };

  const calculateCustomTotal = () => entries.reduce((sum, entry) => sum + (entry.amount || 0), 0);

  const getRemainingAmount = () => {
    if (mode === "equal") return 0;
    return (transaction.net_amount ?? transaction.amount) - calculateCustomTotal();
  };

  const isBalanced = () => {
    if (mode === "equal") return entries.length > 0;
    return Math.abs(getRemainingAmount()) < 0.01;
  };

  const calculateMyShare = () => {
    if (!includeMe) return 0;
    if (mode === "equal") return (transaction.net_amount ?? transaction.amount) / entries.length;
    return entries.find(entry => entry.participant === "me")?.amount || 0;
  };

  const handleSave = () => {
    if (!isBalanced()) return;
    const splitBreakdown: SplitBreakdown = {
      mode,
      include_me: includeMe,
      entries: entries.map(entry => ({
        participant: entry.participant,
        amount: mode === "equal" ? null : entry.amount,
        paid_share: entry.paid_share,
        net_balance: entry.net_balance,
      })),
      paid_by: paidBy,
      total_participants: entries.length,
    };
    onSave(splitBreakdown, calculateMyShare());
    onClose();
  };

  const handleModeChange = (newMode: "equal" | "custom") => {
    setMode(newMode);
    setEntries(entries.map(entry => ({
      participant: entry.participant,
      amount: newMode === "equal" ? null : (entry.amount || 0),
    })));
  };

  const totalAmount = transaction.net_amount ?? transaction.amount;
  const balanced = isBalanced();
  const remaining = getRemainingAmount();

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<Users className="h-4 w-4" />}
        title="Share Expenses"
        onClose={onClose}
        variant="share"
      />

      <Modal.Body className="space-y-5">

        {/* ── Transaction Summary ── */}
        <div className="rounded-xl bg-muted/40 border border-border/60 p-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-semibold text-sm text-foreground truncate">{transaction.description}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatDate(transaction.date)}</p>
            {transaction.net_amount !== undefined && transaction.net_amount !== transaction.amount && (
              <p className="text-xs text-primary mt-1">
                Net after refunds: {formatCurrency(transaction.net_amount)}
              </p>
            )}
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="font-mono text-lg font-bold text-foreground tabular-nums tracking-tight">
              {formatCurrency(totalAmount)}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Total</p>
          </div>
        </div>

        {/* ── Split Mode Segmented Control ── */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Split Mode</p>
          <div className="relative flex h-9 rounded-lg overflow-hidden border border-border bg-muted text-xs font-medium">
            <div
              className={cn(
                "absolute inset-y-0 w-1/2 transition-[left] duration-200 ease-out bg-primary/15",
                mode === "equal" ? "left-0" : "left-1/2"
              )}
            />
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => handleModeChange("equal")}
              className={cn(
                "relative z-10 flex-1 flex items-center justify-center gap-1.5 transition-colors",
                mode === "equal" ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Calculator className="h-3 w-3" />
              Equal Split
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => handleModeChange("custom")}
              className={cn(
                "relative z-10 flex-1 flex items-center justify-center gap-1.5 transition-colors border-l border-border",
                mode === "custom" ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Users className="h-3 w-3" />
              Custom Amounts
            </motion.button>
          </div>
        </div>

        {/* ── Include Me Toggle ── */}
        <div className="flex items-center gap-2.5">
          <Checkbox
            id="includeMe"
            checked={includeMe}
            onCheckedChange={(checked) => setIncludeMe(checked === true)}
          />
          <Label htmlFor="includeMe" className="text-sm cursor-pointer">
            Include me in the split
          </Label>
        </div>

        {/* ── Who Paid — Participant Pills ── */}
        {entries.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Who Paid?</p>
            <div className="flex flex-wrap gap-2">
              {entries.map((entry) => {
                const isPaid = paidBy === entry.participant;
                const displayName = entry.participant === "me" ? "Me" : toTitleCase(entry.participant);
                return (
                  <motion.button
                    key={entry.participant}
                    type="button"
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setPaidBy(entry.participant)}
                    className={cn(
                      "flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                      isPaid
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                    )}
                  >
                    <ParticipantAvatar name={entry.participant} size="sm" />
                    {displayName}
                    <AnimatePresence>
                      {isPaid && (
                        <motion.span
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          transition={{ type: "spring", stiffness: 400, damping: 25 }}
                        >
                          <Check className="h-3 w-3" />
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </motion.button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Participants ── */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Participants</p>

          {/* Participant rows — swipe-reveal trash on hover */}
          <div className="space-y-1.5">
            <AnimatePresence initial={false}>
              {entries.map((entry, index) => {
                const displayName = entry.participant === "me" ? "Me" : toTitleCase(entry.participant);
                const canDelete = entry.participant !== "me";
                return (
                  <motion.div
                    key={entry.participant}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6, height: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 35 }}
                    className="group relative overflow-hidden rounded-lg border border-border/50"
                  >
                    {/* Card content — slides left on hover to reveal trash */}
                    <div className={cn(
                      "flex items-center gap-3 px-3 py-2.5 bg-muted/30 transition-transform duration-200 ease-out",
                      canDelete && "group-hover:-translate-x-14"
                    )}>
                      <ParticipantAvatar name={entry.participant} />

                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block">{displayName}</span>
                        {entry.participant === paidBy && (
                          <span className="text-[10px] text-emerald-400 font-medium">Paid</span>
                        )}
                      </div>

                      {/* Amount — animated mode switch */}
                      <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                          key={mode}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.13 }}
                        >
                          {mode === "custom" ? (
                            <div className="relative">
                              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono">₹</span>
                              <Input
                                type="number"
                                step="0.01"
                                value={entry.amount || ""}
                                onChange={(e) => updateParticipantAmount(index, parseFloat(e.target.value) || 0)}
                                className="w-28 pl-7 text-right font-mono tabular-nums h-8 text-sm bg-muted/60"
                                placeholder="0.00"
                              />
                            </div>
                          ) : (
                            <span className="font-mono text-sm font-semibold text-primary tabular-nums w-28 text-right block">
                              {formatCurrency(calculateEqualSplit())}
                            </span>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>

                    {/* Trash zone — fixed to right edge, slides in as content slides out */}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => removeParticipant(index)}
                        className="absolute right-0 inset-y-0 w-14 flex items-center justify-center bg-destructive/90 hover:bg-destructive translate-x-full group-hover:translate-x-0 transition-transform duration-200 ease-out rounded-r-lg"
                      >
                        <Trash2 className="h-4 w-4 text-white" />
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {/* Add participant — multi-select popover */}
          <Popover open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) setSearch(""); }}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="mt-1 flex items-center gap-1.5 w-full px-3 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add participant…
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="p-0 w-[var(--radix-popover-trigger-width)]"
              align="start"
              side="bottom"
              onInteractOutside={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest('[role="dialog"]')) {
                  e.preventDefault();
                }
              }}
            >
              <div className="flex items-center border-b px-3">
                <Input
                  placeholder="Search participants…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="border-0 focus-visible:ring-0 h-10 text-sm bg-transparent px-0 shadow-none"
                />
              </div>
              <div className="max-h-[220px] overflow-y-auto p-1">
                {filteredParticipants.length === 0 ? (
                  <p className="py-4 text-xs text-center text-muted-foreground">No participants found</p>
                ) : (
                  filteredParticipants.map(p => {
                    const isAdded = entries.some(e => e.participant === p.name);
                    return (
                      <div
                        key={p.id}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (isAdded) {
                            const idx = entries.findIndex(entry => entry.participant === p.name);
                            if (idx !== -1) removeParticipant(idx);
                            setSelectedParticipants(prev => prev.filter(sp => sp !== p.name));
                          } else {
                            setEntries(prev => [...prev, { participant: p.name, amount: mode === "custom" ? 0 : null }]);
                            setSelectedParticipants(prev => [...prev, p.name]);
                          }
                        }}
                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground select-none"
                      >
                        <div className={cn(
                          "flex h-4 w-4 items-center justify-center rounded-sm border flex-shrink-0",
                          isAdded ? "bg-primary border-primary" : "border-muted-foreground/40"
                        )}>
                          {isAdded && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                        <ParticipantAvatar name={p.name} size="sm" />
                        <span className="text-sm truncate">{toTitleCase(p.name)}</span>
                      </div>
                    );
                  })
                )}
              </div>
              {entries.filter(e => e.participant !== "me").length > 0 && (
                <div className="border-t p-2 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {entries.filter(e => e.participant !== "me").length} selected
                  </span>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); setAddOpen(false); setSearch(""); }}
                    className="text-xs text-primary hover:underline"
                  >
                    Done
                  </button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* ── Balance Summary (custom mode) ── */}
        <AnimatePresence initial={false}>
          {mode === "custom" && (
            <motion.div
              key="balance"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
              className="overflow-hidden"
            >
              <div className={cn(
                "rounded-xl border p-3 transition-colors duration-300",
                balanced
                  ? "bg-emerald-500/8 border-emerald-500/25"
                  : "bg-muted/40 border-border/60"
              )}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total Assigned</span>
                  <span className="font-mono font-semibold tabular-nums">{formatCurrency(calculateCustomTotal())}</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="text-muted-foreground">Remaining</span>
                  <AnimatePresence mode="wait">
                    {balanced ? (
                      <motion.span
                        key="balanced"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="flex items-center gap-1.5 text-emerald-400 font-semibold font-mono"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Balanced
                      </motion.span>
                    ) : (
                      <motion.span
                        key="unbalanced"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="font-mono font-semibold text-destructive tabular-nums"
                      >
                        {formatCurrency(remaining)}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── My Share ── */}
        <AnimatePresence>
          {includeMe && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 40 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl bg-primary/8 border border-primary/20 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your Share</p>
                  {mode === "equal" && entries.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Equal among {entries.length} {entries.length === 1 ? "person" : "people"}
                    </p>
                  )}
                </div>
                <p className="font-mono text-xl font-bold text-primary tabular-nums tracking-tight">
                  {formatCurrency(calculateMyShare())}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Validation hint ── */}
        <AnimatePresence>
          {!balanced && mode === "equal" && entries.length === 0 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-xs text-destructive"
            >
              Add at least one participant to continue.
            </motion.p>
          )}
        </AnimatePresence>

      </Modal.Body>

      <Modal.Footer>
        <div className="flex justify-between w-full">
          <div>
            {transaction.is_shared && onClearSplit && (
              <Button variant="destructive" size="sm" onClick={onClearSplit} disabled={isLoading}>
                Clear Split
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!balanced || entries.length === 0 || isLoading}
            >
              {isLoading ? "Saving…" : "Save Split"}
            </Button>
          </div>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
