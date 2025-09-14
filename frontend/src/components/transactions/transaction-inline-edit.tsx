"use client";

import React, { useState } from "react";
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

interface TransactionInlineEditProps {
  transaction: Transaction;
  field: keyof Transaction;
  onCancel: () => void;
  onSuccess: () => void;
}

export function TransactionInlineEdit({
  transaction,
  field,
  onCancel,
  onSuccess,
}: TransactionInlineEditProps) {
  const [value, setValue] = useState<string>(String(transaction[field] || ""));
  const updateTransaction = useUpdateTransaction();
  const { data: categoriesData } = useCategories();
  const categories = categoriesData?.data || [];

  const handleSave = async () => {
    try {
      let updateValue: any = value;
      
      // Convert value based on field type
      if (field === "amount" || field === "split_share_amount") {
        updateValue = parseFloat(value);
      } else if (field === "is_shared" || field === "is_refund" || field === "is_transfer") {
        updateValue = value === "true";
      }

      await updateTransaction.mutateAsync({
        id: transaction.id,
        updates: { [field]: updateValue },
      });

      toast.success("Transaction updated successfully");
      onSuccess();
    } catch (error) {
      toast.error("Failed to update transaction");
      console.error("Update error:", error);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  const renderInput = () => {
    switch (field) {
      case "category":
        return (
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.name}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            onKeyPress={handleKeyPress}
            className="w-full"
            autoFocus
          />
        );

      default:
        return (
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyPress={handleKeyPress}
            className="w-full"
            autoFocus
          />
        );
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        {renderInput()}
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={handleSave}
          disabled={updateTransaction.isPending}
          className="h-8 w-8 p-0"
        >
          {updateTransaction.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4 text-green-600" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={updateTransaction.isPending}
          className="h-8 w-8 p-0"
        >
          <X className="h-4 w-4 text-red-600" />
        </Button>
      </div>
    </div>
  );
}
