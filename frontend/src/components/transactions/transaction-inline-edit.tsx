"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateTransaction } from "@/hooks/use-transactions";
import { useCategories } from "@/hooks/use-categories";
import { Transaction } from "@/lib/types";
import { Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CategoryAutocomplete } from "./category-autocomplete";
import { FieldAutocomplete } from "./field-autocomplete";
import { apiClient } from "@/lib/api/client";

interface TransactionInlineEditProps {
  transaction: Transaction;
  field: keyof Transaction;
  onCancel: () => void;
  onSuccess: () => void;
  onTabNext?: () => void;
  onTabPrevious?: () => void;
}

export function TransactionInlineEdit({
  transaction,
  field,
  onCancel,
  onSuccess,
  onTabNext,
  onTabPrevious,
}: TransactionInlineEditProps) {
  const [value, setValue] = useState<string>(String(transaction[field] || ""));
  const updateTransaction = useUpdateTransaction();
  const { data: categories = [] } = useCategories();

  const handleSave = async (saveValue?: string) => {
    const valueToSave = saveValue !== undefined ? saveValue : value;

    try {
      // Ensure we have a valid string value
      if (typeof valueToSave !== 'string') {
        toast.error("Invalid value type");
        return;
      }

      let updateValue: any = valueToSave;
      const updates: Record<string, any> = { [field]: updateValue };

      // Convert value based on field type
      if (field === "amount" || field === "split_share_amount") {
        updateValue = parseFloat(valueToSave);
        updates[field] = updateValue;
      } else if (field === "is_shared" || field === "is_refund" || field === "is_transfer") {
        updateValue = valueToSave === "true";
        updates[field] = updateValue;
      }

      // Category Intelligence: If updating description, try to predict category
      if (field === "description" && !transaction.category) {
        try {
          // Import apiClient dynamically or assume it's imported (need to add import)
          // Since we can't easily add import at top with replace_file_content in one go if top is far away,
          // checking if imports are nearby. They are not.
          // We will use the already imported apiClient if I add the import.
          // For now, let's assume I will add import in a separate step or used full file replacement if needed.
          // Actually, I can rely on the fact that I will add the import next.

          // Predicted category
          // Logic: If description changes and category is empty -> predict
          const prediction = await apiClient.predictCategory(valueToSave);
          if (prediction.data) {
            updates.category = prediction.data.name;
            toast.info(`Auto-categorized as ${prediction.data.name}`);
          }
        } catch (err) {
          console.error("Failed to predict category", err);
        }
      }

      await updateTransaction.mutateAsync({
        id: transaction.id,
        updates: updates,
      });

      toast.success("Transaction updated successfully");
      onSuccess();
    } catch (error) {
      toast.error("Failed to update transaction");
      console.error("Update error:", error);
    }
  };

  const handleKeyPress = async (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await handleSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      e.preventDefault();
      // Save and move to next/previous cell
      await handleSave();
      if (e.shiftKey) {
        onTabPrevious?.();
      } else {
        onTabNext?.();
      }
    }
  };

  const renderInput = () => {
    switch (field) {
      case "category":
        return (
          <CategoryAutocomplete
            value={value}
            onValueChange={setValue}
            onSave={handleSave}
            onCancel={onCancel}
            placeholder="Type category..."
            className="w-full"
            transactionDirection={transaction.direction}
          />
        );

      case "description":
      case "notes":
      case "account":
      case "paid_by":
        return (
          <FieldAutocomplete
            fieldName={field}
            value={value}
            onValueChange={setValue}
            onSave={handleSave}
            onCancel={onCancel}
            onTabNext={onTabNext}
            onTabPrevious={onTabPrevious}
            placeholder={`Type ${field}...`}
            className="w-full"
          />
        );

      case "direction":
        return (
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select direction" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="debit">Debit</SelectItem>
              <SelectItem value="credit">Credit</SelectItem>
            </SelectContent>
          </Select>
        );

      case "amount":
      case "split_share_amount":
        return (
          <Input
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyPress}
            className="w-full"
            autoFocus
          />
        );

      default:
        return (
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyPress}
            className="w-full"
            autoFocus
          />
        );
    }
  };

  // For category and field autocomplete components, they handle their own actions
  if (field === "category" || field === "description" || field === "notes" || field === "account" || field === "paid_by") {
    return renderInput();
  }

  // For other fields, show the traditional save/cancel buttons
  return (
    <div className="flex items-center gap-1 w-full max-w-full overflow-hidden">
      <div className="flex-1 min-w-0">
        {renderInput()}
      </div>
      <div className="flex gap-0.5 flex-shrink-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleSave()}
          disabled={updateTransaction.isPending}
          className="h-5 w-5 p-0"
        >
          {updateTransaction.isPending ? (
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
          ) : (
            <Check className="h-2.5 w-2.5 text-green-600" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={updateTransaction.isPending}
          className="h-5 w-5 p-0"
        >
          <X className="h-2.5 w-2.5 text-red-600" />
        </Button>
      </div>
    </div>
  );
}
