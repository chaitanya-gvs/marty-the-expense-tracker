"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useBulkUpdateTransactions, useUpdateTransaction } from "@/hooks/use-transactions";
import { useCategories } from "@/hooks/use-categories";
import { useTags } from "@/hooks/use-tags";
import { Transaction, Tag } from "@/lib/types";
import { Loader2, Users, ChevronDown, ChevronRight, Replace } from "lucide-react";
import { toast } from "sonner";
import { CategorySelector } from "./category-selector";
import { MultiTagSelector } from "./multi-tag-selector";
import { cn } from "@/lib/utils";

interface BulkEditModalProps {
  selectedTransactions: Transaction[];
  isOpen: boolean;
  onClose: () => void;
}

export function BulkEditModal({
  selectedTransactions,
  isOpen,
  onClose,
}: BulkEditModalProps) {
  const [formData, setFormData] = useState<Partial<Transaction>>({});
  const [selectedTags, setSelectedTags] = useState<Tag[]>([]);
  const [updateFields, setUpdateFields] = useState<Set<string>>(new Set());
  const [isTransactionsExpanded, setIsTransactionsExpanded] = useState(false);
  const [descriptionMode, setDescriptionMode] = useState<"set" | "find-replace">("set");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [categoryMode, setCategoryMode] = useState<"set" | "clear">("set");
  const [tagsMode, setTagsMode] = useState<"add" | "replace" | "clear">("add");

  const bulkUpdateTransactions = useBulkUpdateTransactions();
  const updateTransaction = useUpdateTransaction();
  const { data: categories = [] } = useCategories();
  const { data: tagsData } = useTags();

  const allTags = tagsData || [];

  useEffect(() => {
    if (isOpen && selectedTransactions.length > 0) {
      setFormData({});
      setSelectedTags([]);
      setUpdateFields(new Set());
      setIsTransactionsExpanded(false);
      setDescriptionMode("set");
      setFindText("");
      setReplaceText("");
      setCategoryMode("set");
      setTagsMode("add");
    }
  }, [isOpen, selectedTransactions]);

  const handleInputChange = (
    field: keyof Transaction,
    value: string | number | boolean | string[]
  ) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (value !== undefined && value !== null && value !== "") {
      setUpdateFields(prev => new Set([...prev, field]));
    } else {
      setUpdateFields(prev => {
        const newSet = new Set(prev);
        newSet.delete(field);
        return newSet;
      });
    }
  };

  const handleTagsChange = (tags: Tag[]) => {
    setSelectedTags(tags);
    setUpdateFields(prev => new Set([...prev, "tags"]));
  };

  const handleFieldToggle = (field: keyof Transaction) => {
    setUpdateFields(prev => {
      const newSet = new Set(prev);
      if (newSet.has(field)) {
        newSet.delete(field);
        setFormData(prevData => {
          const newData = { ...prevData };
          delete newData[field];
          return newData;
        });
        if (field === "tags") setSelectedTags([]);
        if (field === "description") { setDescriptionMode("set"); setFindText(""); setReplaceText(""); }
        if (field === "category") setCategoryMode("set");
        if (field === "tags") setTagsMode("replace");
      } else {
        newSet.add(field);
      }
      return newSet;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (updateFields.size === 0) { toast.error("Please select at least one field to update"); return; }

    try {
      const updates: Partial<Transaction> = {};
      const isFindReplace = updateFields.has("description") && descriptionMode === "find-replace";

      updateFields.forEach(field => {
        if (field === "tags") {
          if (tagsMode === "clear") updates.tags = [];
          else if (tagsMode === "replace") updates.tags = selectedTags.map(tag => tag.name);
        } else if (field === "category") {
          updates.category = categoryMode === "clear" ? "" : (formData.category || "");
        } else if (field === "description" && isFindReplace) {
          // handled per-transaction below
        } else if (formData[field as keyof Transaction] !== undefined) {
          (updates as Record<string, unknown>)[field] = formData[field as keyof Transaction];
        }
      });

      const transactionIds = selectedTransactions.map(t => t.id);

      if (Object.keys(updates).length > 0) {
        await bulkUpdateTransactions.mutateAsync({ transactionIds, updates });
      }

      if (isFindReplace && findText.trim()) {
        await Promise.all(
          selectedTransactions.map(tx => {
            const newDescription = tx.description.replaceAll(findText, replaceText);
            if (newDescription === tx.description) return Promise.resolve();
            return updateTransaction.mutateAsync({ id: tx.id, updates: { description: newDescription } });
          })
        );
      }

      if (updateFields.has("tags") && tagsMode === "add" && selectedTags.length > 0) {
        await Promise.all(
          selectedTransactions.map(tx => {
            const existingTagNames: string[] = (tx.tags || []).map((t: string | { name: string }) =>
              typeof t === "string" ? t : t.name
            );
            const newTagNames = selectedTags.map(tag => tag.name);
            const mergedTags = [...new Set([...existingTagNames, ...newTagNames])];
            if (newTagNames.every(n => existingTagNames.includes(n))) return Promise.resolve();
            return updateTransaction.mutateAsync({ id: tx.id, updates: { tags: mergedTags } });
          })
        );
      }

      toast.success(`Updated ${selectedTransactions.length} transaction${selectedTransactions.length !== 1 ? "s" : ""}`);
      await new Promise(resolve => setTimeout(resolve, 200));
      onClose();
    } catch {
      toast.error("Failed to update transactions");
    }
  };

  const getUpdatePreview = () => {
    const fieldsToUpdate: string[] = [];
    if (updateFields.has("description")) {
      fieldsToUpdate.push(descriptionMode === "find-replace"
        ? (findText ? `Description (find "${findText}" → "${replaceText}")` : "Description (find & replace)")
        : "Description");
    }
    if (updateFields.has("category")) fieldsToUpdate.push(categoryMode === "clear" ? "Category (clear)" : "Category");
    if (updateFields.has("tags")) fieldsToUpdate.push(
      tagsMode === "clear" ? "Tags (clear all)" : tagsMode === "replace" ? "Tags (replace)" : "Tags (append)"
    );
    if (fieldsToUpdate.length === 0) return null;
    return `Will update: ${fieldsToUpdate.join(", ")}`;
  };

  return (
    <Modal open={isOpen} onClose={onClose} size="lg">
      <Modal.Header
        icon={<Users className="h-4 w-4" />}
        title={`Bulk Edit (${selectedTransactions.length} selected)`}
        subtitle="Choose which fields to update. Others stay unchanged."
        onClose={onClose}
        variant="share"
      />

      <form onSubmit={handleSubmit}>
        <Modal.Body className="space-y-3">
          <div className="space-y-2">
            {/* Description Field */}
            <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
              <div className="flex items-center gap-3">
                <Switch
                  checked={updateFields.has("description")}
                  onCheckedChange={() => handleFieldToggle("description")}
                  className="data-[state=checked]:bg-primary"
                />
                <div className="flex items-center justify-between flex-1">
                  <label className="text-sm font-medium text-foreground">Description</label>
                  {updateFields.has("description") && (
                    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/60 p-0.5">
                      <button
                        type="button"
                        onClick={() => setDescriptionMode("set")}
                        className={cn(
                          "px-2 py-0.5 text-xs rounded transition-colors",
                          descriptionMode === "set" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Set
                      </button>
                      <button
                        type="button"
                        onClick={() => setDescriptionMode("find-replace")}
                        className={cn(
                          "flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors",
                          descriptionMode === "find-replace" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Replace className="h-3 w-3" />
                        Find & Replace
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <AnimatePresence initial={false}>
                {updateFields.has("description") ? (
                  <motion.div
                    key="desc-active"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 40 }}
                    style={{ overflow: "hidden" }}
                  >
                    {descriptionMode === "set" ? (
                      <Input
                        value={formData.description || ""}
                        onChange={(e) => handleInputChange("description", e.target.value)}
                        placeholder="Enter new description for all selected"
                        className="mt-2 h-10"
                      />
                    ) : (
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-14 shrink-0">Find</span>
                          <Input value={findText} onChange={(e) => setFindText(e.target.value)} placeholder="Text to find…" className="h-10 text-sm" />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-14 shrink-0">Replace</span>
                          <Input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder="Replace with…" className="h-10 text-sm" />
                        </div>
                        {findText && (
                          <p className="text-xs text-muted-foreground pl-16">
                            Will update {selectedTransactions.filter(tx => tx.description.includes(findText)).length} of {selectedTransactions.length} transactions
                          </p>
                        )}
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.p
                    key="desc-inactive"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-xs text-muted-foreground mt-0.5 ml-11"
                  >
                    Click to enable
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            {/* Category Field */}
            <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
              <div className="flex items-center gap-3">
                <Switch
                  checked={updateFields.has("category")}
                  onCheckedChange={() => handleFieldToggle("category")}
                  className="data-[state=checked]:bg-primary"
                />
                <div className="flex items-center justify-between flex-1">
                  <label className="text-sm font-medium text-foreground">Category</label>
                  {updateFields.has("category") && (
                    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/60 p-0.5">
                      <button type="button" onClick={() => setCategoryMode("set")} className={cn("px-2 py-0.5 text-xs rounded transition-colors", categoryMode === "set" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Set</button>
                      <button type="button" onClick={() => setCategoryMode("clear")} className={cn("px-2 py-0.5 text-xs rounded transition-colors", categoryMode === "clear" ? "bg-background text-destructive shadow-sm" : "text-muted-foreground hover:text-foreground")}>Clear</button>
                    </div>
                  )}
                </div>
              </div>
              {updateFields.has("category") ? (
                categoryMode === "set" ? (
                  <div className="mt-2">
                    <CategorySelector value={formData.category || ""} onValueChange={(category) => handleInputChange("category", category)} placeholder="Select category" />
                  </div>
                ) : (
                  <p className="text-xs text-destructive/80 mt-2 ml-11">Will remove category from all selected transactions</p>
                )
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5 ml-11">Click to enable</p>
              )}
            </div>

            {/* Tags Field */}
            <div className="p-3 rounded-lg bg-muted/40 border border-border/50">
              <div className="flex items-center gap-3">
                <Switch
                  checked={updateFields.has("tags")}
                  onCheckedChange={() => handleFieldToggle("tags")}
                  className="data-[state=checked]:bg-primary"
                />
                <div className="flex items-center justify-between flex-1">
                  <label className="text-sm font-medium text-foreground">Tags</label>
                  {updateFields.has("tags") && (
                    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/60 p-0.5">
                      <button type="button" onClick={() => setTagsMode("add")} className={cn("px-2 py-0.5 text-xs rounded transition-colors", tagsMode === "add" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Add</button>
                      <button type="button" onClick={() => setTagsMode("replace")} className={cn("px-2 py-0.5 text-xs rounded transition-colors", tagsMode === "replace" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Replace</button>
                      <button type="button" onClick={() => setTagsMode("clear")} className={cn("px-2 py-0.5 text-xs rounded transition-colors", tagsMode === "clear" ? "bg-background text-destructive shadow-sm" : "text-muted-foreground hover:text-foreground")}>Clear</button>
                    </div>
                  )}
                </div>
              </div>
              {updateFields.has("tags") ? (
                tagsMode === "clear" ? (
                  <p className="text-xs text-destructive/80 mt-2 ml-11">Will remove all tags from selected transactions</p>
                ) : (
                  <div className="mt-2 space-y-1">
                    <MultiTagSelector selectedTags={selectedTags} onTagsChange={handleTagsChange} placeholder={tagsMode === "add" ? "Tags to append…" : "Tags to replace with…"} />
                    {tagsMode === "add" && <p className="text-xs text-muted-foreground ml-0.5">Selected tags will be added to any existing tags</p>}
                  </div>
                )
              ) : (
                <p className="text-xs text-muted-foreground mt-0.5 ml-11">Click to enable</p>
              )}
            </div>
          </div>

          {/* Collapsible Selected Transactions */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setIsTransactionsExpanded(!isTransactionsExpanded)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isTransactionsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span>{selectedTransactions.length} selected transactions</span>
            </button>
            {isTransactionsExpanded && (
              <div className="max-h-48 overflow-y-auto space-y-1 mt-2">
                {selectedTransactions.map((transaction) => (
                  <div key={transaction.id} className="p-2 rounded-md bg-muted/30 border border-border/40 text-xs">
                    <span className="font-medium text-foreground">{transaction.description}</span>
                    <span className="text-muted-foreground font-mono"> · {transaction.date} · ₹{transaction.amount}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {getUpdatePreview() && (
            <div className="text-xs text-muted-foreground pt-3 border-t border-border">
              {getUpdatePreview()}
            </div>
          )}
        </Modal.Body>

        <Modal.Footer>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={
              bulkUpdateTransactions.isPending ||
              updateTransaction.isPending ||
              updateFields.size === 0 ||
              (updateFields.has("description") && descriptionMode === "find-replace" && !findText.trim())
            }
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {(bulkUpdateTransactions.isPending || updateTransaction.isPending) ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Updating...</>
            ) : (
              <>Update {selectedTransactions.length} Transaction{selectedTransactions.length !== 1 ? "s" : ""}</>
            )}
          </Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
}
