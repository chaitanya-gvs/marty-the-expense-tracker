"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DollarSignIcon, UsersIcon, TrendingUpIcon, TrendingDownIcon } from 'lucide-react';
import { useSettlements, useSettlementDetail, useSettlementParticipants } from '@/hooks/use-settlements';
import { formatCurrency } from '@/lib/format-utils';
import { SettlementEntry } from '@/lib/types';
import { SettlementFilters } from '@/components/settlements/settlement-filters';
import { MainLayout } from '@/components/layout/main-layout';

interface SettlementFiltersState {
  date_range_start?: string;
  date_range_end?: string;
  min_amount?: number;
  participant?: string;
}

function SettlementsPageContent() {
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);
  const [settlementFilters, setSettlementFilters] = useState<SettlementFiltersState>({});

  const { settlementSummary, loading: summaryLoading, error: summaryError } = useSettlements(settlementFilters);
  const { participants, loading: participantsLoading } = useSettlementParticipants();
  const { settlementDetail, loading: detailLoading } = useSettlementDetail(
    selectedParticipant || '', 
    settlementFilters
  );

  const formatBalance = (amount: number) => {
    const isPositive = amount > 0;
    return (
      <span className={`font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
        {isPositive ? '+' : ''}{formatCurrency(amount)}
      </span>
    );
  };

  const getBalanceIcon = (amount: number) => {
    if (amount > 0) return <TrendingUpIcon className="h-4 w-4 text-green-600" />;
    if (amount < 0) return <TrendingDownIcon className="h-4 w-4 text-red-600" />;
    return <DollarSignIcon className="h-4 w-4 text-gray-600" />;
  };

  const SettlementCard = ({ settlement }: { settlement: SettlementEntry }) => (
    <Card 
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => setSelectedParticipant(settlement.participant)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{settlement.participant}</CardTitle>
          <div className="flex items-center gap-2">
            {getBalanceIcon(settlement.net_balance)}
            {formatBalance(settlement.net_balance)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>Owed to me:</span>
            <span className="text-green-600">{formatCurrency(settlement.amount_owed_to_me)}</span>
          </div>
          <div className="flex justify-between">
            <span>I owe:</span>
            <span className="text-red-600">{formatCurrency(settlement.amount_i_owe)}</span>
          </div>
          <div className="flex justify-between">
            <span>Transactions:</span>
            <Badge variant="secondary">{settlement.transaction_count}</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (summaryError) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Error Loading Settlements</h1>
          <p className="text-gray-600">{summaryError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Settlements & Balances</h1>
          <p className="text-gray-600 mt-1">Track what you owe and what others owe you</p>
        </div>
      </div>

      {/* Filters */}
      <SettlementFilters
        filters={settlementFilters}
        onFiltersChange={setSettlementFilters}
        onClearFilters={() => setSettlementFilters({})}
      />

      {/* Summary Stats */}
      {settlementSummary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Owed to Me</CardTitle>
              <DollarSignIcon className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(settlementSummary.total_amount_owed_to_me)}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total I Owe</CardTitle>
              <DollarSignIcon className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {formatCurrency(settlementSummary.total_amount_i_owe)}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Net Balance</CardTitle>
              {getBalanceIcon(settlementSummary.net_total_balance)}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatBalance(settlementSummary.net_total_balance)}
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Participants</CardTitle>
              <UsersIcon className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {settlementSummary.participant_count}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Content */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="details" disabled={!selectedParticipant}>
            Details {selectedParticipant && `(${selectedParticipant})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {summaryLoading ? (
            <div className="text-center py-8">
              <div className="text-gray-600">Loading settlements...</div>
            </div>
          ) : settlementSummary?.settlements.length === 0 ? (
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-gray-600">No outstanding settlements found.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {settlementSummary?.settlements.map((settlement) => (
                <SettlementCard key={settlement.participant} settlement={settlement} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="details" className="space-y-4">
          {selectedParticipant ? (
            detailLoading ? (
              <div className="text-center py-8">
                <div className="text-gray-600">Loading details for {selectedParticipant}...</div>
              </div>
            ) : settlementDetail ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Settlement with {selectedParticipant}</CardTitle>
                    <CardDescription>
                      Net balance: {formatBalance(settlementDetail.net_balance)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Total shared amount:</span>
                        <span className="ml-2 font-medium">{formatCurrency(settlementDetail.total_shared_amount)}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Number of transactions:</span>
                        <span className="ml-2 font-medium">{settlementDetail.transactions.length}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Transaction History</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {settlementDetail.transactions.map((transaction) => (
                        <div key={transaction.id} className="border rounded-lg p-3">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <h4 className="font-medium">{transaction.description}</h4>
                              <p className="text-sm text-gray-600">{transaction.date}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-medium">{formatCurrency(transaction.amount)}</p>
                              <p className="text-sm text-gray-600">Paid by: {transaction.paid_by}</p>
                            </div>
                          </div>
                          <div className="flex justify-between text-sm text-gray-600">
                            <span>My share: {formatCurrency(transaction.my_share)}</span>
                            <span>{selectedParticipant}'s share: {formatCurrency(transaction.participant_share)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="text-center py-8">
                  <p className="text-gray-600">No settlement details found for {selectedParticipant}.</p>
                </CardContent>
              </Card>
            )
          ) : (
            <Card>
              <CardContent className="text-center py-8">
                <p className="text-gray-600">Select a participant from the overview to see detailed settlement information.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettlementsPage() {
  return (
    <MainLayout>
      <SettlementsPageContent />
    </MainLayout>
  );
}
