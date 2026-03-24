"use client";

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, TrendingUp, TrendingDown, Users, Minus, ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react';
import { useSplitwiseFriends, useSplitwiseFriendExpenses } from '@/hooks/use-settlements';
import { apiClient } from '@/lib/api/client';
import { formatCurrency } from '@/lib/format-utils';
import { SplitwiseFriend } from '@/lib/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type SubTab = 'overview' | 'details';

export function SplitwiseTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');
  const [selectedFriendId, setSelectedFriendId] = useState<number | null>(null);
  const [settledExpanded, setSettledExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const { friends, loading, error, refetch } = useSplitwiseFriends();
  const { expenses, loading: expLoading, error: expError } = useSplitwiseFriendExpenses(selectedFriendId);

  useEffect(() => {
    return () => { if (pollInterval.current) clearInterval(pollInterval.current); };
  }, []);

  const owedToMe = friends.filter(f => f.net_balance > 0).reduce((sum, f) => sum + f.net_balance, 0);
  const iOwe = friends.filter(f => f.net_balance < 0).reduce((sum, f) => sum + Math.abs(f.net_balance), 0);
  const net = owedToMe - iOwe;
  const peopleCount = friends.filter(f => f.net_balance !== 0).length;

  const nonZeroFriends = friends.filter(f => f.net_balance !== 0);
  const zeroFriends = friends.filter(f => f.net_balance === 0);
  const selectedFriend = friends.find(f => f.id === selectedFriendId) ?? null;

  const friendDisplayName = (f: SplitwiseFriend) =>
    `${f.first_name}${f.last_name ? ' ' + f.last_name : ''}`;

  const handleFriendClick = (friend: SplitwiseFriend) => {
    setSelectedFriendId(friend.id);
    setActiveSubTab('details');
    setExpandedGroups(new Set());
  };

  const handleBack = () => {
    setSelectedFriendId(null);
    setActiveSubTab('overview');
  };

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

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const expenseGroups: Record<string, typeof expenses> = {};
  expenses.forEach(e => {
    const key = e.group_name ?? 'No Group';
    if (!expenseGroups[key]) expenseGroups[key] = [];
    expenseGroups[key].push(e);
  });

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

      {activeSubTab === 'overview' && (
        <>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map(i => (
                <Card key={i} className="py-4">
                  <CardContent className="px-4 space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-3 w-16" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex items-center justify-center h-24">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Friend cards grid */}
              {nonZeroFriends.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 space-y-2">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted">
                    <Users className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground">All settled up</p>
                  <p className="text-xs text-muted-foreground">No outstanding balances with friends</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {nonZeroFriends.map(friend => (
                    <Card
                      key={friend.id}
                      className="cursor-pointer hover:bg-muted/30 transition-colors py-4"
                      onClick={() => handleFriendClick(friend)}
                    >
                      <CardContent className="px-4">
                        <div className="flex items-center gap-3">
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
                            {friendDisplayName(friend).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate">{friendDisplayName(friend)}</p>
                            <p className={cn(
                              "font-mono text-sm font-semibold tabular-nums",
                              friend.net_balance > 0 ? "text-green-600" : "text-red-600"
                            )}>
                              {friend.net_balance > 0 ? '+' : ''}{formatCurrency(friend.net_balance)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {friend.net_balance > 0 ? 'owes you' : 'you owe'}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Settled accordion */}
              {zeroFriends.length > 0 && (
                <div className="border border-border rounded-lg">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:bg-muted/40 transition-colors rounded-lg"
                    onClick={() => setSettledExpanded(v => !v)}
                  >
                    <span>Settled ({zeroFriends.length})</span>
                    {settledExpanded
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />}
                  </button>
                  {settledExpanded && (
                    <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {zeroFriends.map(friend => (
                        <Card
                          key={friend.id}
                          className="cursor-pointer opacity-60 hover:opacity-100 hover:bg-muted/30 transition-all py-3"
                          onClick={() => handleFriendClick(friend)}
                        >
                          <CardContent className="px-3">
                            <div className="flex items-center gap-2">
                              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-muted text-muted-foreground text-xs font-semibold shrink-0">
                                {friendDisplayName(friend).charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{friendDisplayName(friend)}</p>
                                <p className="text-xs text-muted-foreground">Settled</p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}

      {activeSubTab === 'details' && selectedFriend && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <div>
              <h2 className="text-lg font-semibold text-foreground">{friendDisplayName(selectedFriend)}</h2>
              <p className={cn(
                "text-sm font-mono tabular-nums",
                selectedFriend.net_balance > 0 ? "text-green-600" : "text-red-600"
              )}>
                {selectedFriend.net_balance > 0
                  ? `${formatCurrency(selectedFriend.net_balance)} owed to you`
                  : `You owe ${formatCurrency(Math.abs(selectedFriend.net_balance))}`}
              </p>
            </div>
          </div>

          {/* Loading skeletons */}
          {expLoading && (
            <div className="space-y-3">
              {[1, 2].map(i => (
                <div key={i} className="border border-border rounded-lg p-4 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <div className="space-y-2 pt-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {expError && (
            <p className="text-sm text-destructive">{expError}</p>
          )}

          {!expLoading && !expError && expenses.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 space-y-2">
              <p className="text-sm font-medium text-foreground">No recent expenses found</p>
              <p className="text-xs text-muted-foreground">Sync to fetch latest Splitwise data</p>
            </div>
          )}

          {!expLoading && Object.entries(expenseGroups).map(([groupName, groupExpenses]) => (
            <div key={groupName} className="border border-border rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40 transition-colors"
                onClick={() => toggleGroup(groupName)}
              >
                <span>{groupName} <span className="text-muted-foreground font-normal">({groupExpenses.length})</span></span>
                {expandedGroups.has(groupName)
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </button>
              {expandedGroups.has(groupName) && (
                <div className="divide-y divide-border">
                  {groupExpenses.map(expense => (
                    <div key={expense.id} className="px-4 py-3">
                      <div className="flex justify-between items-start">
                        <div className="min-w-0 mr-4">
                          <p className="text-sm font-medium text-foreground truncate">{expense.description}</p>
                          <p className="text-xs text-muted-foreground">{expense.date}</p>
                          {expense.category && (
                            <span className="inline-flex items-center rounded-md bg-primary/10 text-primary text-xs px-2 py-0.5 mt-1">
                              {expense.category}
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-sm font-semibold text-foreground tabular-nums shrink-0">
                          {formatCurrency(expense.cost)}
                        </p>
                      </div>
                      <div className="mt-2 space-y-1">
                        {expense.users.map((user, i) => (
                          <div key={i} className="flex justify-between text-xs text-muted-foreground">
                            <span>{user.name}</span>
                            <span className="font-mono tabular-nums">
                              paid {formatCurrency(user.paid_share)} · owes {formatCurrency(user.owed_share)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
