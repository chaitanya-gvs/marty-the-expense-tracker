import type { WorkflowEvent } from "@/lib/api/types/workflow";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface WorkflowSubTask {
  id: string;
  label: string;
  status: TaskStatus;
  events: WorkflowEvent[];
}

export interface WorkflowTask {
  id: string;
  label: string;
  status: TaskStatus;
  subtasks: WorkflowSubTask[];
}

// ─── Subtask routing ─────────────────────────────────────────────────────────

/**
 * Maps an event to the subtask id it belongs to, given the event's step and name.
 * Returns null for events that are task-level (no specific subtask).
 */
function getSubTaskId(event: WorkflowEvent): string | null {
  const e = event.event;
  const s = event.step;

  // Download subtask
  if (
    s === "email_search" ||
    s === "pdf_download" ||
    e === "email_search_started" ||
    e === "email_found" ||
    e === "email_search_complete" ||
    e === "email_search_failed" ||
    e === "pdf_download_started" ||
    e === "pdf_downloaded" ||
    e === "pdf_download_failed" ||
    e === "statement_duplicate_skipped"
  ) {
    return "download";
  }

  // Unlock subtask
  if (
    s === "pdf_unlock" ||
    e === "pdf_unlock_started" ||
    e === "pdf_unlocked" ||
    e === "pdf_unlock_failed" ||
    e === "pdf_resume_from_gcs"
  ) {
    return "unlock";
  }

  // Filter pages subtask
  if (s === "pdf_page_filter" || e === "pdf_pages_filtered") {
    return "filter";
  }

  // Extract subtask
  if (
    s === "extraction" ||
    e === "extraction_started" ||
    e === "extraction_complete" ||
    e === "extraction_failed" ||
    e === "extraction_skipped"
  ) {
    return "extract";
  }

  // Upload to GCS subtask
  if (
    s === "gcs_upload" ||
    e === "gcs_upload_started" ||
    e === "gcs_uploaded" ||
    e === "gcs_upload_failed"
  ) {
    return "upload";
  }

  return null;
}

// ─── Status derivation ────────────────────────────────────────────────────────

function eventToStatus(event: WorkflowEvent): TaskStatus {
  const e = event.event;
  const level = event.level;

  if (e.endsWith("_started")) {
    return "running";
  }
  if (
    e.endsWith("_failed") ||
    e === "workflow_error" ||
    level === "error"
  ) {
    return "error";
  }
  if (
    e === "extraction_skipped" ||
    (e === "email_search_complete" &&
      (event.data as { downloaded_count?: number }).downloaded_count === 0)
  ) {
    return "skipped";
  }
  if (
    e.endsWith("_complete") ||
    e.endsWith("_uploaded") ||
    e.endsWith("_unlocked") ||
    e.endsWith("_downloaded") ||
    e === "pdf_pages_filtered" ||
    e === "token_refresh_complete" ||
    level === "success"
  ) {
    return "done";
  }

  return "running";
}

const STATUS_PRIORITY: Record<TaskStatus, number> = {
  error: 5,
  running: 4,
  pending: 3,
  skipped: 2,
  done: 1,
};

function worstStatus(statuses: TaskStatus[]): TaskStatus {
  if (statuses.length === 0) return "pending";
  return statuses.reduce((acc, s) =>
    STATUS_PRIORITY[s] > STATUS_PRIORITY[acc] ? s : acc
  );
}

// ─── Subtask label map ────────────────────────────────────────────────────────

const SUBTASK_LABELS: Record<string, string> = {
  download: "Download email / PDF",
  unlock: "Unlock PDF",
  filter: "Filter pages",
  extract: "Extract transactions",
  upload: "Upload to GCS",
  auth: "Authenticate Gmail",
  sync: "Fetch & upload",
  standardize: "Standardize transactions",
  db_insert: "Insert to database",
};

const SUBTASK_ORDER = ["download", "unlock", "filter", "extract", "upload"];

// ─── Task ID constants ────────────────────────────────────────────────────────

const SETUP_TASK_ID = "setup";
const SPLITWISE_TASK_ID = "splitwise";
const FINALIZE_TASK_ID = "finalize";

/** Steps that belong to the "finalize" task */
const FINALIZE_STEPS = new Set([
  "standardization",
  "db_insert",
]);

const FINALIZE_EVENTS = new Set([
  "db_insert_started",
  "db_insert_complete",
  "standardization_started",
  "standardization_file_started",
  "standardization_file_complete",
  "standardization_file_failed",
  "standardization_complete",
  "standardization_skipped",
]);

const EMAIL_INGESTION_TASK_ID = "email_ingestion";

const EMAIL_INGESTION_EVENTS = new Set([
  "email_ingestion_started",
  "email_ingestion_complete",
  "email_ingestion_skipped",
  "email_ingestion_error",
  "email_ingestion_account_started",
  "email_ingestion_account_complete",
]);

// ─── buildTaskTree ─────────────────────────────────────────────────────────────

/**
 * Pure function: given the flat event array, return a structured task tree.
 * Called via useMemo so it is re-derived on every new event.
 */
export function buildTaskTree(events: WorkflowEvent[]): WorkflowTask[] {
  // Ordered list of task ids (preserves arrival order)
  const taskOrder: string[] = [];
  const taskMap: Map<string, WorkflowTask> = new Map();

  // Mutable helpers — current sender task we are routing into
  let currentSenderTaskId: string | null = null;

  function ensureTask(id: string, label: string): WorkflowTask {
    if (!taskMap.has(id)) {
      taskMap.set(id, { id, label, status: "pending", subtasks: [] });
      taskOrder.push(id);
    }
    return taskMap.get(id)!;
  }

  function ensureSubTask(task: WorkflowTask, subtaskId: string): WorkflowSubTask {
    let sub = task.subtasks.find((s) => s.id === subtaskId);
    if (!sub) {
      sub = {
        id: subtaskId,
        label: SUBTASK_LABELS[subtaskId] ?? subtaskId,
        status: "pending",
        events: [],
      };
      // Insert in canonical order
      const pos = SUBTASK_ORDER.indexOf(subtaskId);
      const insertAt = task.subtasks.findIndex(
        (s) => SUBTASK_ORDER.indexOf(s.id) > pos
      );
      if (insertAt === -1) {
        task.subtasks.push(sub);
      } else {
        task.subtasks.splice(insertAt, 0, sub);
      }
    }
    return sub;
  }

  for (const event of events) {
    const e = event.event;
    const s = event.step;

    // ── Workflow-level events: skip (shown in header/status badge only) ──
    if (s === "workflow" || e === "workflow_started" || e === "workflow_complete" || e === "workflow_error" || e === "workflow_cancelled") {
      continue;
    }

    // ── Setup task: token refresh ──
    if (s === "token_refresh") {
      const task = ensureTask(SETUP_TASK_ID, "Setup");
      // Setup has no subtasks — push events directly (treated as a single flat subtask "auth")
      const sub = ensureSubTask(task, "auth");
      sub.events.push(event);
      sub.status = eventToStatus(event);
      task.status = worstStatus(task.subtasks.map((st) => st.status));
      continue;
    }

    // ── Account already fully complete — skip the whole task ──
    if (e === "account_already_complete") {
      const sender = (event.data as { sender?: string }).sender ?? "unknown";
      const nickname =
        (event.data as { account_nickname?: string | null }).account_nickname ??
        sender;
      const taskKey = nickname !== sender ? `account:${nickname}` : `sender:${sender}`;
      const task = ensureTask(taskKey, nickname);
      task.status = "done";
      // Mark all subtasks as done so the badge shows correctly
      for (const subtaskId of SUBTASK_ORDER) {
        const sub = ensureSubTask(task, subtaskId);
        sub.status = "done";
        sub.events.push(event);
      }
      continue;
    }

    // ── Start of a new sender's processing ──
    if (e === "email_search_started") {
      const sender = (event.data as { sender?: string }).sender ?? "unknown";
      const nickname =
        (event.data as { account_nickname?: string | null }).account_nickname ??
        sender;
      // Key by nickname so two sender emails for the same account merge into one task
      const taskKey = nickname !== sender ? `account:${nickname}` : `sender:${sender}`;
      currentSenderTaskId = taskKey;
      const task = ensureTask(taskKey, nickname);
      // Route to download subtask
      const sub = ensureSubTask(task, "download");
      sub.events.push(event);
      sub.status = eventToStatus(event);
      task.status = "running";
      continue;
    }

    // ── Splitwise task ──
    if (
      s === "splitwise" ||
      e === "splitwise_sync_started" ||
      e === "splitwise_sync_complete" ||
      e === "splitwise_sync_failed"
    ) {
      const task = ensureTask(SPLITWISE_TASK_ID, "Splitwise Sync");
      const sub = ensureSubTask(task, "sync");
      sub.events.push(event);
      sub.status = eventToStatus(event);
      task.status = sub.status;
      continue;
    }

    // ── Finalize task ──
    if (FINALIZE_STEPS.has(s) || FINALIZE_EVENTS.has(e)) {
      const task = ensureTask(FINALIZE_TASK_ID, "Finalize");
      const subtaskId = s === "db_insert" || e.startsWith("db_insert") ? "db_insert" : "standardize";
      const sub = ensureSubTask(task, subtaskId);
      sub.events.push(event);
      sub.status = eventToStatus(event);
      task.status = worstStatus(task.subtasks.map((st) => st.status));
      continue;
    }

    // ── Email ingestion task ──
    if (EMAIL_INGESTION_EVENTS.has(e)) {
      const task = ensureTask(EMAIL_INGESTION_TASK_ID, "Email Ingestion");

      if (e === "email_ingestion_account_started" || e === "email_ingestion_account_complete") {
        // Per-account subtask
        const accountName =
          event.account ??
          (event.data as { account?: string }).account ??
          "unknown";
        const subtaskId = `account:${accountName}`;
        let sub = task.subtasks.find((s) => s.id === subtaskId);
        if (!sub) {
          sub = {
            id: subtaskId,
            label: accountName,
            status: "pending",
            events: [],
          };
          task.subtasks.push(sub);
        }
        sub.events.push(event);
        sub.status = eventToStatus(event);
        task.status = worstStatus(task.subtasks.map((st) => st.status));
      } else {
        // Task-level event
        task.status = eventToStatus(event);
      }
      continue;
    }

    // ── Per-sender subtask events ──
    if (currentSenderTaskId) {
      const task = taskMap.get(currentSenderTaskId);
      if (task) {
        const subtaskId = getSubTaskId(event);
        if (subtaskId) {
          const sub = ensureSubTask(task, subtaskId);
          sub.events.push(event);
          sub.status = eventToStatus(event);
          task.status = worstStatus(task.subtasks.map((st) => st.status));
        }
        continue;
      }
    }
  }

  return taskOrder.map((id) => taskMap.get(id)!);
}

