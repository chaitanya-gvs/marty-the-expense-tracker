"use client";

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { DollarSignIcon, UsersIcon, TrendingUpIcon, TrendingDownIcon, TrendingUp, TrendingDown, Minus, Calendar, Clock } from 'lucide-react';
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
  participants?: string[];
  show_owed_to_me_only?: boolean;
  show_shared_only?: boolean;
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

  const getParticipantAvatar = (participant: string) => {
    const initials = participant.split(' ').map(n => n[0]).join('').toUpperCase();
    const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500', 'bg-indigo-500'];
    const colorIndex = participant.charCodeAt(0) % colors.length;
    
    return (
      <div className={`w-10 h-10 rounded-full ${colors[colorIndex]} flex items-center justify-center text-white font-semibold text-sm`}>
        {initials}
      </div>
    );
  };

  const SettlementCard = ({ settlement }: { settlement: SettlementEntry }) => (
    <Card 
      className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-[1.02] border-l-4 border-l-blue-500 group"
      onClick={() => setSelectedParticipant(settlement.participant)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {getParticipantAvatar(settlement.participant)}
            <div>
              <CardTitle className="text-lg group-hover:text-blue-600 transition-colors">
                {settlement.participant}
              </CardTitle>
              <p className="text-sm text-gray-500">{settlement.transaction_count} transactions</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getBalanceIcon(settlement.net_balance)}
            <span className="text-lg font-semibold">
              {formatBalance(settlement.net_balance)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">Owed to me:</span>
            <span className="text-green-600 font-medium">{formatCurrency(settlement.amount_owed_to_me)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">I owe:</span>
            <span className="text-red-600 font-medium">{formatCurrency(settlement.amount_i_owe)}</span>
          </div>
        </div>
        
        {settlement.net_balance > 0 && (
          <div className="mt-4 pt-3 border-t border-gray-100">
            <Button 
              size="sm" 
              className="w-full bg-green-600 hover:bg-green-700 text-white"
              onClick={(e) => {
                e.stopPropagation();
                // TODO: Implement settlement functionality
                console.log(`Settle up with ${settlement.participant} for ${formatCurrency(settlement.net_balance)}`);
              }}
            >
              Mark ₹{formatCurrency(settlement.net_balance)} received from {settlement.participant}
            </Button>
          </div>
        )}
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
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>Last synced: {new Date().toLocaleDateString('en-IN', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}</span>
            </div>
            <span>•</span>
            <span>Auto-updates every 24 hrs</span>
          </div>
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
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Card 
                  className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-[1.02] border-l-4 border-l-green-500"
                  onClick={() => {
                    // Filter to show only participants who owe money
                    setSettlementFilters(prev => ({
                      ...prev,
                      participant: undefined // Clear participant filter to show all
                    }));
                  }}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <span>💸</span>
                      Total Owed to Me
                    </CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600 tracking-tight">
                      {formatCurrency(settlementSummary.total_amount_owed_to_me)}
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent>
                <p>Sum of positive balances from shared transactions</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Card 
                  className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-[1.02] border-l-4 border-l-red-500"
                  onClick={() => {
                    // Filter to show only participants you owe money to
                    const oweParticipants = settlementSummary.settlements
                      .filter(s => s.net_balance < 0)
                      .map(s => s.participant);
                    if (oweParticipants.length > 0) {
                      setSettlementFilters(prev => ({
                        ...prev,
                        participant: oweParticipants[0] // Show first participant you owe
                      }));
                    }
                  }}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <span>🧾</span>
                      Total I Owe
                    </CardTitle>
                    <TrendingDown className="h-4 w-4 text-red-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600 tracking-tight">
                      {formatCurrency(settlementSummary.total_amount_i_owe)}
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent>
                <p>Sum of negative balances (amounts you owe)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Card className={`cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-[1.02] border-l-4 ${
                  settlementSummary.net_total_balance > 0 ? 'border-l-green-500' : 
                  settlementSummary.net_total_balance < 0 ? 'border-l-red-500' : 'border-l-gray-500'
                }`}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <span>⚖️</span>
                      Net Balance
                    </CardTitle>
                    {getBalanceIcon(settlementSummary.net_total_balance)}
                  </CardHeader>
                  <CardContent>
                    <div className={`text-2xl font-bold tracking-tight ${
                      settlementSummary.net_total_balance > 0 ? 'text-green-600' : 
                      settlementSummary.net_total_balance < 0 ? 'text-red-600' : 'text-gray-600'
                    }`}>
                      {formatBalance(settlementSummary.net_total_balance)}
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent>
                <p>Difference between what's owed to you and what you owe</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Card className="cursor-pointer hover:shadow-lg transition-all duration-200 hover:scale-[1.02] border-l-4 border-l-blue-500">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <span>👥</span>
                      Participants
                    </CardTitle>
                    <UsersIcon className="h-4 w-4 text-blue-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-600 tracking-tight">
                      {settlementSummary.participant_count}
                    </div>
                  </CardContent>
                </Card>
              </TooltipTrigger>
              <TooltipContent>
                <p>Number of people with outstanding balances</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      {/* Main Content */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="overview" className="transition-all duration-200">Overview</TabsTrigger>
          <TabsTrigger value="details" disabled={!selectedParticipant} className="transition-all duration-200">
            Details {selectedParticipant && `(${selectedParticipant})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 animate-in fade-in-50 duration-300">
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {settlementSummary?.settlements
                .filter((settlement) => {
                  // Apply show_owed_to_me_only filter
                  if (settlementFilters.show_owed_to_me_only && settlement.net_balance <= 0) {
                    return false;
                  }
                  
                  // Apply show_shared_only filter (if implemented in backend)
                  if (settlementFilters.show_shared_only && settlement.transaction_count === 0) {
                    return false;
                  }
                  
                  return true;
                })
                .map((settlement) => (
                  <div key={settlement.participant} className="animate-in slide-in-from-bottom-4 duration-300">
                    <SettlementCard settlement={settlement} />
                  </div>
                ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="details" className="space-y-4 animate-in fade-in-50 duration-300">
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
                              <p className="text-sm text-gray-600">Paid by: {transaction.paid_by || 'Unknown'}</p>
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
