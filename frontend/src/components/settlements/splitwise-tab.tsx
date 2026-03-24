"use client";

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, TrendingUp, TrendingDown, Users, Minus, ChevronDown } from 'lucide-react';
import { useSplitwiseFriends, useSplitwiseFriendExpenses } from '@/hooks/use-settlements';
import { apiClient } from '@/lib/api/client';
import { formatCurrency } from '@/lib/format-utils';
import { SplitwiseFriend } from '@/lib/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const friendDisplayName = (f: SplitwiseFriend) =>
  `${f.first_name}${f.last_name ? ' ' + f.last_name : ''}`;

interface SplitwiseFriendRowProps {
  friend: SplitwiseFriend;
  isExpanded: boolean;
  onToggle: () => void;
}

function SplitwiseFriendRow({ friend, isExpanded, onToggle }: SplitwiseFriendRowProps) {
  const { expenses, loading, error } = useSplitwiseFriendExpenses(isExpanded ? friend.id : null);

  const name = friendDisplayName(friend);
  const initials = name.split(' ').map(n => n[0] ?? '').join('').toUpperCase().slice(0, 2) || '?';

  const subtitle =
    friend.net_balance > 0 ? 'owes you' :
    friend.net_balance < 0 ? 'you owe' :
    'settled';

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
            <p className="text-sm font-semibold text-foreground truncate">{name}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-4">
          <p className={cn(
            'font-mono text-sm font-semibold tabular-nums',
            friend.net_balance > 0 ? 'text-green-600' :
            friend.net_balance < 0 ? 'text-red-600' :
            'text-foreground'
          )}>
            {friend.net_balance > 0 ? '+' : ''}{formatCurrency(friend.net_balance)}
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
          {/* Summary strip */}
          <div className="flex items-center gap-6 text-xs">
            {friend.net_balance > 0 ? (
              <span className="text-muted-foreground">
                Owed to me:{' '}
                <span className="font-mono tabular-nums text-green-600 font-semibold">
                  {formatCurrency(friend.net_balance)}
                </span>
              </span>
            ) : friend.net_balance < 0 ? (
              <span className="text-muted-foreground">
                I owe:{' '}
                <span className="font-mono tabular-nums text-red-600 font-semibold">
                  {formatCurrency(Math.abs(friend.net_balance))}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Settled up</span>
            )}
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

          {/* Flat expense list */}
          {!loading && !error && expenses.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">No expenses found</p>
          )}

          {!loading && !error && expenses.length > 0 && (
            <div className="space-y-0">
              {expenses.map(expense => {
                const payer = expense.users.reduce(
                  (max, u) => u.paid_share > max.paid_share ? u : max,
                  expense.users[0]
                );
                return (
                  <div key={expense.id} className="py-2.5 border-b border-border/50 last:border-0">
                    {/* Row 1: description + cost */}
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-sm text-foreground truncate min-w-0 flex-1">{expense.description}</p>
                      <p className="font-mono text-xs text-muted-foreground tabular-nums shrink-0">
                        {formatCurrency(expense.cost)}
                      </p>
                    </div>
                    {/* Row 2: date/payer + per-user owed shares */}
                    <div className="flex items-center justify-between mt-0.5 gap-4">
                      <p className="text-xs text-muted-foreground min-w-0 truncate">
                        {expense.date}
                        {payer && ` · paid by ${payer.name}`}
                      </p>
                      <div className="flex items-center gap-3 shrink-0">
                        {expense.users.map((user, i) => (
                          <span key={i} className="text-xs text-muted-foreground">
                            {user.name.split(' ')[0]}:{' '}
                            <span className="font-mono font-semibold tabular-nums text-foreground">
                              {formatCurrency(user.owed_share)}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SplitwiseTab() {
  const [expandedFriendId, setExpandedFriendId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const { friends, loading, error, refetch } = useSplitwiseFriends();

  useEffect(() => {
    return () => { if (pollInterval.current) clearInterval(pollInterval.current); };
  }, []);

  const owedToMe = friends.filter(f => f.net_balance > 0).reduce((sum, f) => sum + f.net_balance, 0);
  const iOwe = friends.filter(f => f.net_balance < 0).reduce((sum, f) => sum + Math.abs(f.net_balance), 0);
  const net = owedToMe - iOwe;
  const peopleCount = friends.filter(f => f.net_balance !== 0).length;

  const sortedFriends = [
    ...friends.filter(f => f.net_balance !== 0).sort((a, b) => Math.abs(b.net_balance) - Math.abs(a.net_balance)),
    ...friends.filter(f => f.net_balance === 0),
  ];

  const stopPolling = () => {
    if (pollInterval.current) {
      clearInterval(pollInterval.current);
      pollInterval.current = null;
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await apiClient.startWorkflow({ mode: 'splitwise_only' });
      const jobId = (res as unknown as { job_id: string }).job_id;
      if (!jobId) throw new Error('No job_id returned');

      pollInterval.current = setInterval(async () => {
        try {
          const statusRes = await apiClient.getWorkflowStatus(jobId);
          const status = statusRes.status;
          if (status === 'completed' || status === 'failed' || status === 'cancelled') {
            stopPolling();
            setSyncing(false);
            refetch();
          }
        } catch {
          stopPolling();
          setSyncing(false);
        }
      }, 2000);
    } catch (err: unknown) {
      setSyncing(false);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('409') || message.includes('already in progress')) {
        toast.error('Sync already in progress');
      } else {
        toast.error('Failed to start sync');
      }
    }
  };

  const handleToggle = (id: number) => {
    setExpandedFriendId(prev => (prev === id ? null : id));
  };

  return (
    <div className="space-y-4 mt-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Live from Splitwise</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSyncNow}
          disabled={syncing}
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", syncing && "animate-spin")} />
          {syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-border overflow-hidden bg-border gap-px">
        <div className="bg-card px-3 py-4">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            Owed to Me
          </p>
          <p className="font-mono text-sm font-semibold text-green-600 tabular-nums">
            {formatCurrency(owedToMe)}
          </p>
        </div>
        <div className="bg-card px-3 py-4">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <TrendingDown className="h-3 w-3" />
            I Owe
          </p>
          <p className="font-mono text-sm font-semibold text-red-600 tabular-nums">
            {formatCurrency(iOwe)}
          </p>
        </div>
        <div className="bg-card px-3 py-4">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Minus className="h-3 w-3" />
            Net
          </p>
          <p className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            net > 0 ? "text-green-600" : net < 0 ? "text-red-600" : "text-foreground"
          )}>
            {net > 0 ? '+' : ''}{formatCurrency(net)}
          </p>
        </div>
        <div className="bg-card px-3 py-4">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Users className="h-3 w-3" />
            People
          </p>
          <p className="font-mono text-sm font-semibold text-foreground tabular-nums">
            {peopleCount}
          </p>
        </div>
      </div>

      {/* Loading skeletons */}
      {loading && (
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
      )}

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-center h-24">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Friend rows */}
      {!loading && !error && (
        sortedFriends.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 space-y-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
              <Users className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">All settled up</p>
            <p className="text-xs text-muted-foreground">No outstanding balances with friends</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedFriends.map(friend => (
              <SplitwiseFriendRow
                key={friend.id}
                friend={friend}
                isExpanded={expandedFriendId === friend.id}
                onToggle={() => handleToggle(friend.id)}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}
