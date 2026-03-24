"use client";

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp, TrendingDown, Users, DollarSign, ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react';
import { useSplitwiseFriends, useSplitwiseFriendExpenses } from '@/hooks/use-settlements';
import { apiClient } from '@/lib/api/client';
import { formatCurrency } from '@/lib/format-utils';
import { SplitwiseFriend } from '@/lib/types';
import { toast } from 'sonner';

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

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollInterval.current) clearInterval(pollInterval.current); };
  }, []);

  // Computed stats
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

  // Group expenses by group_name
  const expenseGroups: Record<string, typeof expenses> = {};
  expenses.forEach(e => {
    const key = e.group_name ?? 'No Group';
    if (!expenseGroups[key]) expenseGroups[key] = [];
    expenseGroups[key].push(e);
  });

  return (
    <div className="space-y-4 mt-4">
      {/* Tab header with Sync Now */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">Live from Splitwise</div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSyncNow}
          disabled={syncing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync Now'}
        </Button>
      </div>

      {activeSubTab === 'overview' && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-600" />
                  <div>
                    <p className="text-xs text-gray-500">Owed to Me</p>
                    <p className="font-semibold text-green-600">{formatCurrency(owedToMe)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-600" />
                  <div>
                    <p className="text-xs text-gray-500">I Owe</p>
                    <p className="font-semibold text-red-600">{formatCurrency(iOwe)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-blue-600" />
                  <div>
                    <p className="text-xs text-gray-500">Net</p>
                    <p className={`font-semibold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {net >= 0 ? '+' : ''}{formatCurrency(net)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-purple-600" />
                  <div>
                    <p className="text-xs text-gray-500">People</p>
                    <p className="font-semibold text-purple-600">{peopleCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Loading / error */}
          {loading && <p className="text-sm text-gray-500">Loading friends…</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}

          {!loading && !error && (
            <>
              {/* Friend cards grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {nonZeroFriends.map(friend => (
                  <Card
                    key={friend.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => handleFriendClick(friend)}
                  >
                    <CardContent className="pt-4">
                      <div className="font-semibold">{friendDisplayName(friend)}</div>
                      <div className={`text-lg font-bold mt-1 ${friend.net_balance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {friend.net_balance > 0 ? '+' : ''}{formatCurrency(friend.net_balance)}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {friend.net_balance > 0 ? 'owes you' : 'you owe'}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Settled accordion */}
              {zeroFriends.length > 0 && (
                <div className="border rounded-lg">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-500 hover:bg-gray-50"
                    onClick={() => setSettledExpanded(v => !v)}
                  >
                    <span>Settled ({zeroFriends.length})</span>
                    {settledExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  {settledExpanded && (
                    <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {zeroFriends.map(friend => (
                        <Card
                          key={friend.id}
                          className="cursor-pointer hover:shadow-sm transition-shadow opacity-60"
                          onClick={() => handleFriendClick(friend)}
                        >
                          <CardContent className="pt-3 pb-3">
                            <div className="font-medium text-sm">{friendDisplayName(friend)}</div>
                            <div className="text-xs text-gray-400">Settled</div>
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
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <div>
              <h2 className="text-xl font-bold">{friendDisplayName(selectedFriend)}</h2>
              <p className={`text-sm font-medium ${selectedFriend.net_balance > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {selectedFriend.net_balance > 0
                  ? `${formatCurrency(selectedFriend.net_balance)} owed to you`
                  : `You owe ${formatCurrency(Math.abs(selectedFriend.net_balance))}`}
              </p>
            </div>
          </div>

          {/* Expenses */}
          {expLoading && <p className="text-sm text-gray-500">Loading expenses…</p>}
          {expError && <p className="text-sm text-red-500">{expError}</p>}

          {!expLoading && !expError && expenses.length === 0 && (
            <p className="text-sm text-gray-400">No recent expenses found.</p>
          )}

          {!expLoading && Object.entries(expenseGroups).map(([groupName, groupExpenses]) => (
            <div key={groupName} className="border rounded-lg">
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-gray-50"
                onClick={() => toggleGroup(groupName)}
              >
                <span>{groupName} ({groupExpenses.length})</span>
                {expandedGroups.has(groupName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {expandedGroups.has(groupName) && (
                <div className="divide-y">
                  {groupExpenses.map(expense => (
                    <div key={expense.id} className="px-4 py-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-medium text-sm">{expense.description}</div>
                          <div className="text-xs text-gray-400">{expense.date}</div>
                          {expense.category && (
                            <div className="text-xs text-blue-500 mt-0.5">{expense.category}</div>
                          )}
                        </div>
                        <div className="text-sm font-semibold">{formatCurrency(expense.cost)}</div>
                      </div>
                      {/* User shares */}
                      <div className="mt-2 space-y-1">
                        {expense.users.map((user, i) => (
                          <div key={i} className="flex justify-between text-xs text-gray-500">
                            <span>{user.name}</span>
                            <span>paid {formatCurrency(user.paid_share)} · owes {formatCurrency(user.owed_share)}</span>
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
