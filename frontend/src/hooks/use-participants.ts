import { useState, useEffect } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export interface Participant {
  id: string;
  name: string;
  splitwise_id?: number;
  splitwise_email?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ParticipantCreate {
  name: string;
  splitwise_id?: number;
  splitwise_email?: string;
  notes?: string;
}

export interface ParticipantUpdate {
  name?: string;
  splitwise_id?: number;
  splitwise_email?: string;
  notes?: string;
}

interface ParticipantListResponse {
  participants: Participant[];
  total: number;
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const config: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  };

  const response = await fetch(url, config);
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  // Handle empty responses (like 204 No Content)
  const contentType = response.headers.get('content-type');
  if (response.status === 204 || !contentType?.includes('application/json')) {
    return {} as T;
  }

  return response.json();
}

export function useParticipants(search?: string) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchParticipants = async (searchQuery?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery) {
        params.append('search', searchQuery);
      }
      
      const url = `/participants${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await request<ParticipantListResponse>(url);
      setParticipants(response.participants);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch participants';
      setError(errorMessage);
      console.error('Error fetching participants:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const createParticipant = async (participant: ParticipantCreate): Promise<Participant | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await request<Participant>('/participants', {
        method: 'POST',
        body: JSON.stringify(participant),
      });
      await fetchParticipants(search);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create participant';
      setError(errorMessage);
      console.error('Error creating participant:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const updateParticipant = async (id: string, updates: ParticipantUpdate): Promise<Participant | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await request<Participant>(`/participants/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      await fetchParticipants(search);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update participant';
      setError(errorMessage);
      console.error('Error updating participant:', err);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const deleteParticipant = async (id: string): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await request<void>(`/participants/${id}`, {
        method: 'DELETE',
      });
      await fetchParticipants(search);
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete participant';
      setError(errorMessage);
      console.error('Error deleting participant:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchParticipants(search);
  }, [search]);

  return {
    participants,
    isLoading,
    error,
    refetch: fetchParticipants,
    createParticipant,
    updateParticipant,
    deleteParticipant,
  };
}

