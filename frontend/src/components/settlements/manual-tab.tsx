"use client";

import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Minus, Users, Clock, CheckCircle, ChevronDown, Receipt } from 'lucide-react';
import { useSettlements, useSettlementDetail } from '@/hooks/use-settlements';
import { formatCurrency } from '@/lib/format-utils';
import { SettlementEntry, SettlementTransaction } from '@/lib/types';
import { cn } from '@/lib/utils';

interface ParticipantRowProps {
  settlement: SettlementEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

function ParticipantRow({ settlement, isExpanded, onToggle }: ParticipantRowProps) {
  const { settlementDetail, loading, error } = useSettlementDetail(
    isExpanded ? settlement.participant : '',
    {}
  );

  const initials = settlement.participant.split(' ').map(n => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?';

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={onToggle}
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
            {initials}
          </div>
          <div className="text-left min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{settlement.participant}</p>
            <p className="text-xs text-muted-foreground">
              {settlement.net_balance > 0 ? 'owes you' : settlement.net_balance < 0 ? 'you owe' : 'settled'}
              {' · '}{settlement.transaction_count} expense{settlement.transaction_count !== 1 ? 's' : ''}
              {settlement.payment_count && settlement.payment_count > 0
                ? ` · ${settlement.payment_count} payment${settlement.payment_count !== 1 ? 's' : ''}`
                : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <p className={cn(
            'font-mono text-sm font-semibold tabular-nums',
            settlement.net_balance > 0 ? 'text-green-600' : settlement.net_balance < 0 ? 'text-red-600' : 'text-foreground'
          )}>
            {settlement.net_balance > 0 ? '+' : ''}{formatCurrency(settlement.net_balance)}
          </p>
          <ChevronDown className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200',
            isExpanded && 'rotate-180'
          )} />
        </div>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t border-border bg-muted/10 px-4 py-4 space-y-4">
          {/* Summary strip — rendered immediately from SettlementEntry prop, no fetch wait */}
          <div className="flex items-center gap-6 text-xs">
            <span className="text-muted-foreground">
              Owed to me:{' '}
              <span className="font-mono tabular-nums text-green-600 font-semibold">
                {formatCurrency(settlement.amount_owed_to_me)}
              </span>
            </span>
            <span className="text-muted-foreground">
              I owe:{' '}
              <span className="font-mono tabular-nums text-red-600 font-semibold">
                {formatCurrency(settlement.amount_i_owe)}
              </span>
            </span>
          </div>

          {/* Loading skeleton */}
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-full" />
            </div>
          )}

          {/* Error state */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {/* Transactions list */}
          {!loading && settlementDetail && settlementDetail.transactions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-foreground">
                  Expenses ({settlementDetail.transactions.length})
                </p>
              </div>
              <div className="space-y-0">
                {settlementDetail.transactions.map((tx: SettlementTransaction) => {
                  const isPaidByParticipant = (tx.paid_by ?? '').toLowerCase().trim() === settlement.participant.toLowerCase().trim();
                  const myShare = tx.my_share ?? 0;
                  const theirShare = tx.participant_share ?? 0;
                  return (
                    <div key={tx.id} className="py-2.5 border-b border-border/50 last:border-0">
                      {/* Row 1: description + total */}
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm text-foreground truncate min-w-0 flex-1">{tx.description}</p>
                        <p className="font-mono text-xs text-muted-foreground tabular-nums shrink-0">
                          {formatCurrency(tx.amount)}
                        </p>
                      </div>
                      {/* Row 2: date/paid-by + share breakdown */}
                      <div className="flex items-center justify-between mt-0.5 gap-4">
                        <p className="text-xs text-muted-foreground min-w-0 truncate">
                          {new Date(tx.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {tx.paid_by && ` · paid by ${tx.paid_by}`}
                        </p>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-muted-foreground">
                            my share:{' '}
                            <span className={cn(
                              'font-mono font-semibold tabular-nums',
                              myShare === 0
                                ? 'text-muted-foreground'
                                : isPaidByParticipant
                                  ? 'text-red-600'
                                  : 'text-foreground'
                            )}>
                              {isPaidByParticipant && myShare > 0 ? '-' : ''}{formatCurrency(myShare)}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            theirs:{' '}
                            <span className={cn(
                              'font-mono font-semibold tabular-nums',
                              theirShare === 0
                                ? 'text-muted-foreground'
                                : isPaidByParticipant
                                  ? 'text-foreground'
                                  : 'text-green-600'
                            )}>
                              {!isPaidByParticipant && theirShare > 0 ? '+' : ''}{formatCurrency(theirShare)}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Payment history */}
          {!loading && settlementDetail && settlementDetail.payment_history.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                <p className="text-xs font-medium text-foreground">Payment History</p>
              </div>
              <div className="space-y-1.5">
                {settlementDetail.payment_history.map(payment => (
                  <div key={payment.id} className="flex items-center justify-between border-l-2 border-green-600/40 pl-3 py-0.5">
                    <div>
                      <p className="text-sm font-medium text-foreground">{payment.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(payment.date).toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'short', year: 'numeric'
                        })}
                        {payment.paid_by && payment.paid_by !== 'Unknown' && ` · paid by ${payment.paid_by}`}
                      </p>
                    </div>
                    <span className="font-mono text-sm font-semibold tabular-nums text-green-600 ml-4 shrink-0">
                      {formatCurrency(payment.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

export function ManualTab() {
  const [expandedParticipant, setExpandedParticipant] = useState<string | null>(null);
  const [settledExpanded, setSettledExpanded] = useState(false);

  const { settlementSummary, loading: summaryLoading, error: summaryError } = useSettlements({});

  const handleToggle = (participant: string) => {
    setExpandedParticipant(prev => (prev === participant ? null : participant));
  };

  const activeSettlements = (settlementSummary?.settlements ?? []).filter(s => s.net_balance !== 0);
  const settledSettlements = (settlementSummary?.settlements ?? []).filter(s => s.net_balance === 0);

  if (summaryError) {
    return (
      <div className="flex flex-col items-center justify-center h-40 space-y-2 mt-4">
        <p className="text-sm font-medium text-destructive">Error Loading Settlements</p>
        <p className="text-xs text-muted-foreground">{summaryError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 mt-4">
      {/* Last synced row */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" />
        <span>Last synced: {new Date().toLocaleString('en-IN', {
          month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })}</span>
        <span>·</span>
        <span>Auto-updates every 24 hrs</span>
      </div>

      {/* KPI compact grid */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-border overflow-hidden bg-border gap-px">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-card px-3 py-4 space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      ) : settlementSummary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-border overflow-hidden bg-border gap-px">
          <div className="bg-card px-3 py-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Owed to Me
            </p>
            <p className="font-mono text-sm font-semibold text-green-600 tabular-nums">
              {formatCurrency(settlementSummary.total_amount_owed_to_me)}
            </p>
          </div>
          <div className="bg-card px-3 py-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <TrendingDown className="h-3 w-3" />
              I Owe
            </p>
            <p className="font-mono text-sm font-semibold text-red-600 tabular-nums">
              {formatCurrency(settlementSummary.total_amount_i_owe)}
            </p>
          </div>
          <div className="bg-card px-3 py-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Minus className="h-3 w-3" />
              Net Balance
            </p>
            <p className={cn(
              "font-mono text-sm font-semibold tabular-nums",
              settlementSummary.net_total_balance > 0 ? "text-green-600" :
              settlementSummary.net_total_balance < 0 ? "text-red-600" :
              "text-foreground"
            )}>
              {settlementSummary.net_total_balance > 0 ? '+' : ''}
              {formatCurrency(settlementSummary.net_total_balance)}
            </p>
          </div>
          <div className="bg-card px-3 py-4">
            <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Users className="h-3 w-3" />
              Participants
            </p>
            <p className="font-mono text-sm font-semibold text-foreground tabular-nums">
              {settlementSummary.participant_count}
            </p>
          </div>
        </div>
      )}

      {/* Participant row list */}
      {summaryLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="border border-border rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : activeSettlements.length === 0 && settledSettlements.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 space-y-2">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No outstanding settlements</p>
          <p className="text-xs text-muted-foreground">All balances are cleared for the selected period</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeSettlements.map(settlement => (
            <ParticipantRow
              key={settlement.participant}
              settlement={settlement}
              isExpanded={expandedParticipant === settlement.participant}
              onToggle={() => handleToggle(settlement.participant)}
            />
          ))}
          {settledSettlements.length > 0 && (
            <>
              <button
                className="w-full flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setSettledExpanded(v => !v)}
              >
                <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', settledExpanded && 'rotate-180')} />
                Settled ({settledSettlements.length})
              </button>
              {settledExpanded && (
                <div className="space-y-2 opacity-60">
                  {settledSettlements.map(settlement => (
                    <ParticipantRow
                      key={settlement.participant}
                      settlement={settlement}
                      isExpanded={expandedParticipant === settlement.participant}
                      onToggle={() => handleToggle(settlement.participant)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
