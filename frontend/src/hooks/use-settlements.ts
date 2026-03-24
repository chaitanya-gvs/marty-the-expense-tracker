import { useState, useEffect } from 'react';
import { SettlementSummary, SettlementDetail, SplitwiseFriend, SplitwiseFriendExpense } from '@/lib/types';
import { apiClient } from '@/lib/api/client';

interface SettlementFilters {
  date_range_start?: string;
  date_range_end?: string;
  min_amount?: number;
}

export function useSettlements(filters: SettlementFilters = {}) {
  const [settlementSummary, setSettlementSummary] = useState<SettlementSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettlementSummary = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.getSettlementSummary(filters);
      setSettlementSummary(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettlementSummary();
  }, [filters.date_range_start, filters.date_range_end, filters.min_amount]);

  return {
    settlementSummary,
    loading,
    error,
    refetch: fetchSettlementSummary
  };
}

export function useSettlementDetail(participant: string, filters: SettlementFilters = {}) {
  const [settlementDetail, setSettlementDetail] = useState<SettlementDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettlementDetail = async () => {
    if (!participant) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.getSettlementDetail(participant, filters);
      setSettlementDetail(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettlementDetail();
  }, [participant, filters.date_range_start, filters.date_range_end, filters.min_amount]);

  return {
    settlementDetail,
    loading,
    error,
    refetch: fetchSettlementDetail
  };
}

export function useSettlementParticipants() {
  const [participants, setParticipants] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchParticipants = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await apiClient.getSettlementParticipants();
      setParticipants(response.data.participants);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParticipants();
  }, []);

  return {
    participants,
    loading,
    error,
    refetch: fetchParticipants
  };
}

export function useSplitwiseFriends() {
  const [friends, setFriends] = useState<SplitwiseFriend[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFriends = async () => {
    setLoading(true);
    setError(null);
    try {
      // getSplitwiseFriends() returns the array directly (not wrapped in ApiResponse)
      const data = await apiClient.getSplitwiseFriends();
      setFriends(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Splitwise friends');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFriends();
  }, []);

  return { friends, loading, error, refetch: fetchFriends };
}

export function useSplitwiseFriendExpenses(splitwiseId: number | null) {
  const [expenses, setExpenses] = useState<SplitwiseFriendExpense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (splitwiseId === null) {
      setExpenses([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchExpenses = async () => {
      setLoading(true);
      setError(null);
      try {
        // getSplitwiseFriendExpenses() returns the array directly
        const data = await apiClient.getSplitwiseFriendExpenses(splitwiseId);
        if (!cancelled) setExpenses(data ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load expenses');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchExpenses();
    return () => { cancelled = true; };
  }, [splitwiseId]);

  return { expenses, loading, error };
}
