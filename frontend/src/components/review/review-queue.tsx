"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTransactions, useUpdateTransaction } from "@/hooks/use-transactions";
import { CheckCircle, XCircle, Edit, Eye } from "lucide-react";
import { Transaction } from "@/lib/types";
import { format } from "date-fns";

export function ReviewQueue() {
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  
  const { data: transactionsData, isLoading } = useTransactions({
    transaction_type: "needs_review"
  });
  
  const updateTransaction = useUpdateTransaction();
  
  const transactions = transactionsData?.data || [];

  const handleApprove = async (transaction: Transaction) => {
    await updateTransaction.mutateAsync({
      id: transaction.id,
      updates: { status: "reviewed" }
    });
  };

  const handleReject = async (transaction: Transaction) => {
    await updateTransaction.mutateAsync({
      id: transaction.id,
      updates: { status: "uncertain" }
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-gray-900 dark:text-white">Review Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">Transactions Needing Review ({transactions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {transactions.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500 dark:text-green-400" />
                  <p>All transactions have been reviewed!</p>
                </div>
              ) : (
                transactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-medium text-gray-900 dark:text-white">{transaction.description}</h3>
                          <Badge variant="outline">{transaction.account}</Badge>
                          <Badge variant="secondary">{transaction.category}</Badge>
                        </div>
                        
                        <div className="text-sm text-gray-600 dark:text-gray-300 space-y-1">
                          <div>Date: {format(new Date(transaction.date), "MMM dd, yyyy")}</div>
                          <div className="flex items-center gap-4">
                            <span>Amount: ₹{transaction.amount.toLocaleString()}</span>
                            <span>Direction: {transaction.direction}</span>
                          </div>
                          {transaction.notes && (
                            <div>Notes: {transaction.notes}</div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 ml-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedTransaction(transaction)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedTransaction(transaction)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleApprove(transaction)}
                          className="text-green-600 border-green-600 hover:bg-green-50"
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Approve
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReject(transaction)}
                          className="text-red-600 border-red-600 hover:bg-red-50"
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-gray-900 dark:text-white">Transaction Details</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedTransaction ? (
              <div className="space-y-4">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white">{selectedTransaction.description}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-300">{selectedTransaction.account}</p>
                </div>
                
                <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                  <div className="flex justify-between">
                    <span>Date:</span>
                    <span>{format(new Date(selectedTransaction.date), "MMM dd, yyyy")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Amount:</span>
                    <span className="font-medium">₹{selectedTransaction.amount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Category:</span>
                    <span>{selectedTransaction.category}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Direction:</span>
                    <span>{selectedTransaction.direction}</span>
                  </div>
                </div>
                
                {selectedTransaction.notes && (
                  <div>
                    <h4 className="font-medium text-sm mb-1 text-gray-900 dark:text-white">Notes</h4>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{selectedTransaction.notes}</p>
                  </div>
                )}
                
                {selectedTransaction.tags && selectedTransaction.tags.length > 0 && (
                  <div>
                    <h4 className="font-medium text-sm mb-2 text-gray-900 dark:text-white">Tags</h4>
                    <div className="flex flex-wrap gap-1">
                      {selectedTransaction.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="pt-4 border-t">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleApprove(selectedTransaction)}
                      className="flex-1"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleReject(selectedTransaction)}
                      className="flex-1"
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <Eye className="h-12 w-12 mx-auto mb-4" />
                <p>Select a transaction to view details</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
