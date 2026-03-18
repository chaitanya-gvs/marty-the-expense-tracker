export type WorkflowMode = "full" | "resume" | "splitwise_only";

export type WorkflowJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowEventLevel = "info" | "success" | "warning" | "error";

export interface WorkflowEvent {
  event: string;
  step: string;
  message: string;
  level: WorkflowEventLevel;
  account: string | null;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WorkflowRunRequest {
  mode: WorkflowMode;
  start_date?: string | null;
  end_date?: string | null;
  splitwise_start_date?: string | null;
  splitwise_end_date?: string | null;
  enable_secondary_account?: boolean | null;
  override?: boolean;
}

export interface WorkflowRunResponse {
  job_id: string;
  mode: WorkflowMode;
  started_at: string;
}

export interface WorkflowJobStatusResponse {
  job_id: string;
  status: WorkflowJobStatus;
  mode: WorkflowMode;
  started_at: string;
  completed_at: string | null;
  events: WorkflowEvent[];
  summary: Record<string, unknown> | null;
  error: string | null;
}

export interface WorkflowCancelResponse {
  job_id: string;
  status: "cancelling";
}

export interface WorkflowPeriodCheckIncomplete {
  normalized_filename: string;
  status: string;
  account_nickname: string | null;
}

export interface WorkflowPeriodCheck {
  month: string;
  total: number;
  complete: number;
  incomplete: WorkflowPeriodCheckIncomplete[];
  all_done: boolean;
  has_partial: boolean;
}
