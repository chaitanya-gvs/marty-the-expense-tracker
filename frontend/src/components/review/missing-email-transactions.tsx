"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useMissingEmailTransactions } from "@/hooks/use-email-alerts";

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function MissingEmailTransactions() {
  const today = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 30);
    return toDateInputValue(date);
  });
  const [endDate, setEndDate] = useState(() => toDateInputValue(today));
  const [account, setAccount] = useState("");

  const { data, isLoading, refetch } = useMissingEmailTransactions({
    start_date: startDate,
    end_date: endDate,
    account: account || undefined,
    limit: 200,
  });

  const rows = data?.data || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-gray-900 dark:text-white">Missing From Email</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Start date</label>
            <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">End date</label>
            <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Account</label>
            <Input placeholder="Optional account" value={account} onChange={(event) => setAccount(event.target.value)} />
          </div>
          <Button variant="outline" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="h-40 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
        ) : rows.length === 0 ? (
          <div className="text-sm text-gray-500">No missing transactions found for the selected range.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead>Reference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.date}</TableCell>
                  <TableCell>{row.account}</TableCell>
                  <TableCell>{row.description}</TableCell>
                  <TableCell>₹{row.amount.toLocaleString()}</TableCell>
                  <TableCell>
                    <Badge variant={row.direction === "credit" ? "secondary" : "outline"}>
                      {row.direction}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.reference_number || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
