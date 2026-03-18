import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type {
  WorkflowEvent,
  WorkflowJobStatus,
  WorkflowRunRequest,
} from "@/lib/api/types/workflow";

export function useWorkflowPeriodCheck(month?: string) {
  return useQuery({
    queryKey: ["workflow-period-check", month ?? "default"],
    queryFn: () => apiClient.getWorkflowPeriodCheck(month),
    staleTime: 30_000,
  });
}

const TERMINAL_STATUSES: WorkflowJobStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export function useStartWorkflow() {
  return useMutation({
    mutationFn: (req: WorkflowRunRequest) => apiClient.startWorkflow(req),
  });
}

export function useCancelWorkflow() {
  return useMutation({
    mutationFn: (jobId: string) => apiClient.cancelWorkflow(jobId),
  });
}

export function useWorkflowStatus(jobId: string | null) {
  return useQuery({
    queryKey: ["workflow-status", jobId],
    queryFn: () => apiClient.getWorkflowStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || TERMINAL_STATUSES.includes(status)) return false;
      return 3000;
    },
  });
}

/**
 * Manages an EventSource connection for a workflow job.
 * Calls `onEvent` for each SSE message. Closes automatically when a
 * terminal event (`workflow_complete`, `workflow_error`, `workflow_cancelled`)
 * or the internal `stream_end` sentinel is received.
 */
export function useWorkflowStream(
  jobId: string | null,
  onEvent: (event: WorkflowEvent) => void
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const esRef = useRef<EventSource | null>(null);

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!jobId) return;

    // Close any existing connection before opening a new one
    close();

    const es = apiClient.streamWorkflowEvents(jobId);
    esRef.current = es;

    es.onmessage = (msg) => {
      let parsed: WorkflowEvent;
      try {
        parsed = JSON.parse(msg.data);
      } catch {
        return;
      }

      onEventRef.current(parsed);

      const terminal = [
        "workflow_complete",
        "workflow_error",
        "workflow_cancelled",
        "stream_end",
      ];
      if (terminal.includes(parsed.event)) {
        close();
      }
    };

    es.onerror = () => {
      close();
    };

    return close;
  }, [jobId, close]);

  return { close };
}
