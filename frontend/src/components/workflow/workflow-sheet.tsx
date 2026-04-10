"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  FileSearch,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  Square,
  RotateCcw,
  Info,
  TriangleAlert,
  List,
  ListTree,
  X,
  Settings2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  useStartWorkflow,
  useCancelWorkflow,
  useWorkflowStream,
  useWorkflowPeriodCheck,
} from "@/hooks/use-workflow";
import type {
  WorkflowEvent,
  WorkflowJobStatus,
  WorkflowPeriodCheck,
} from "@/lib/api/types/workflow";
import {
  buildTaskTree,
  type TaskStatus,
  type WorkflowSubTask,
  type WorkflowTask,
} from "@/lib/workflow-tasks";

// ─── Last-run stub (replace with API data when endpoint exists) ───────────────

interface LastRunSummary {
  mode: string;
  status: WorkflowJobStatus;
  startedAt: string;         // ISO string
  durationSeconds: number;
  transactionsImported: number;
  statementsProcessed: number;
  periodMonth: string;       // e.g. "2026-02"
  periodComplete: number;
  periodTotal: number;
}

// TODO: replace with real API call (GET /api/workflow/last-run or similar)
const STUB_LAST_RUN: LastRunSummary = {
  mode: "Full run",
  status: "completed",
  startedAt: "2026-03-31T14:32:00.000Z",
  durationSeconds: 187,
  transactionsImported: 284,
  statementsProcessed: 6,
  periodMonth: "2026-02",
  periodComplete: 6,
  periodTotal: 6,
};

// ─── LastRunCard ──────────────────────────────────────────────────────────────

function LastRunCard({
  run,
  periodCheck,
}: {
  run: LastRunSummary;
  periodCheck?: WorkflowPeriodCheck;
}) {
  const startedAt = new Date(run.startedAt);
  const dateLabel = format(startedAt, "MMM d 'at' HH:mm");

  const mins = Math.floor(run.durationSeconds / 60);
  const secs = run.durationSeconds % 60;
  const durationLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const periodAllDone = run.periodComplete === run.periodTotal;

  const statusConfig: Record<WorkflowJobStatus, { dot: string; label: string }> = {
    completed: { dot: "bg-emerald-400",           label: "Completed" },
    failed:    { dot: "bg-[#F44D4D]",             label: "Failed"    },
    cancelled: { dot: "bg-amber-400",             label: "Cancelled" },
    running:   { dot: "bg-sky-400 animate-pulse", label: "Running"   },
    pending:   { dot: "bg-muted-foreground/40",   label: "Pending"   },
  };
  const { dot, label: statusLabel } = statusConfig[run.status];

  // Derive footer alert from periodCheck (live) or fall back to run data
  const showAllDone = periodCheck ? periodCheck.all_done : periodAllDone;
  const showPartial = periodCheck?.has_partial ?? false;
  const alertMonth  = periodCheck?.month ?? run.periodMonth;
  const alertTotal  = periodCheck?.total ?? run.periodTotal;
  const alertComplete = periodCheck?.complete ?? run.periodComplete;
  const incompleteAccounts = periodCheck?.incomplete
    .map((s) => s.account_nickname ?? s.normalized_filename)
    .join(", ");

  return (
    <div className="rounded-xl border border-border/40 bg-muted/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Last run
        </p>
        <div className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", dot)} />
          <span className="text-xs text-muted-foreground/70">{statusLabel}</span>
        </div>
      </div>

      {/* Stats grid — row 1 */}
      <div className="grid grid-cols-3 divide-x divide-border/30 border-b border-border/30">
        <StatCell label="Mode"     value={run.mode} />
        <StatCell label="Date"     value={dateLabel} />
        <StatCell label="Duration" value={durationLabel} mono />
      </div>

      {/* Stats grid — row 2 */}
      <div
        className={cn(
          "grid grid-cols-3 divide-x divide-border/30",
          (showAllDone || showPartial) && "border-b border-border/30"
        )}
      >
        <StatCell
          label="Transactions"
          value={run.transactionsImported.toLocaleString()}
          mono
          highlight={run.transactionsImported > 0}
        />
        <StatCell
          label="Statements"
          value={`${run.statementsProcessed} files`}
          mono
        />
        <StatCell
          label={run.periodMonth}
          value={
            periodAllDone
              ? `All ${run.periodTotal} done`
              : `${run.periodComplete} / ${run.periodTotal}`
          }
          mono
          highlight={periodAllDone}
        />
      </div>

      {/* Period status footer — only shown when there's something to say */}
      {showAllDone && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-400/8 border-amber-400/20">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-400 mt-px" />
          <p className="text-xs text-amber-300/80 leading-relaxed">
            <span className="font-medium text-amber-300">
              {alertMonth} fully processed
            </span>{" "}
            — all {alertTotal} statements complete. Enable{" "}
            <span className="font-medium text-amber-300">Override cache</span> in
            Advanced options to re-extract.
          </p>
        </div>
      )}

      {showPartial && !showAllDone && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-sky-400/8 border-sky-400/20">
          <Info className="h-3.5 w-3.5 shrink-0 text-sky-400 mt-px" />
          <p className="text-xs text-sky-300/80 leading-relaxed">
            <span className="font-medium text-sky-300">
              {alertMonth} incomplete
            </span>{" "}
            — {alertComplete}/{alertTotal} done.
            {incompleteAccounts && (
              <> Pending: {incompleteAccounts}.</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  mono,
  highlight,
}: {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="px-3 py-2.5 flex flex-col gap-0.5">
      <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider truncate">
        {label}
      </p>
      <p
        className={cn(
          "text-sm font-medium truncate",
          mono && "font-mono tabular-nums",
          highlight ? "text-emerald-400" : "text-foreground/80"
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Status badge (job-level) ─────────────────────────────────────────────────

function StatusBadge({ status }: { status: WorkflowJobStatus }) {
  const map: Record<
    WorkflowJobStatus,
    { label: string; className: string; icon: React.ReactNode }
  > = {
    pending: {
      label: "Pending",
      className: "bg-muted/50 text-muted-foreground",
      icon: <Clock className="h-3 w-3" />,
    },
    running: {
      label: "Running",
      className: "bg-sky-400/15 text-sky-300",
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
    },
    completed: {
      label: "Completed",
      className: "bg-emerald-400/15 text-emerald-300",
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    failed: {
      label: "Failed",
      className: "bg-[#F44D4D]/15 text-[#F44D4D]",
      icon: <AlertCircle className="h-3 w-3" />,
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-amber-400/15 text-amber-300",
      icon: <Square className="h-3 w-3" />,
    },
  };
  const { label, className, icon } = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        className
      )}
    >
      {icon}
      {label}
    </span>
  );
}

// ─── Task status icon ─────────────────────────────────────────────────────────

function TaskStatusIcon({
  status,
  size = "md",
}: {
  status: TaskStatus;
  size?: "sm" | "md";
}) {
  const cls = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  switch (status) {
    case "running":
      return <Loader2 className={cn(cls, "text-sky-400 animate-spin shrink-0")} />;
    case "done":
      return <CheckCircle2 className={cn(cls, "text-emerald-400 shrink-0")} />;
    case "error":
      return <AlertCircle className={cn(cls, "text-[#F44D4D] shrink-0")} />;
    case "skipped":
      return <Info className={cn(cls, "text-muted-foreground shrink-0")} />;
    default:
      return <Clock className={cn(cls, "text-muted-foreground/40 shrink-0")} />;
  }
}

// ─── Level icon (for raw event rows) ─────────────────────────────────────────

function LevelIcon({ level }: { level: WorkflowEvent["level"] }) {
  switch (level) {
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
    case "warning":
      return <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#F44D4D]" />;
    default:
      return <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
}

// ─── Single event row ─────────────────────────────────────────────────────────

function EventRow({ event, compact }: { event: WorkflowEvent; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const isPdfPages = event.event === "pdf_pages_filtered";
  const hasPages =
    isPdfPages &&
    Array.isArray((event.data as { kept_pages?: number[] }).kept_pages) &&
    (event.data as { kept_pages: number[] }).kept_pages.length > 0;
  const isFallback = isPdfPages && (event.data as { fallback?: boolean }).fallback;
  const keptPages = hasPages
    ? (event.data as { kept_pages: number[] }).kept_pages
    : [];

  const ts = new Date(event.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const rowBg =
    event.level === "error"
      ? "bg-[#F44D4D]/5"
      : event.level === "warning"
      ? "bg-amber-400/5"
      : event.level === "success"
      ? "bg-emerald-400/5"
      : "";

  return (
    <div
      className={cn(
        "px-3 py-1.5 text-xs border-b border-border last:border-0",
        rowBg,
        compact && "py-1"
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5">
          <LevelIcon level={event.level} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-foreground leading-snug break-words">
              {event.message}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums font-mono">
              {ts}
            </span>
          </div>

          {isPdfPages && !isFallback && hasPages && (
            <div className="mt-1 flex flex-wrap gap-1">
              {keptPages.map((pg) => (
                <span
                  key={pg}
                  className="inline-flex items-center gap-0.5 rounded bg-muted/50 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground"
                >
                  <FileSearch className="h-2.5 w-2.5" />
                  p{pg}
                </span>
              ))}
            </div>
          )}

          {isPdfPages && isFallback && (
            <p className="mt-1 text-[11px] text-muted-foreground italic">
              No matching pages found — sending full PDF to extraction
            </p>
          )}

          {!isPdfPages && Object.keys(event.data).length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              details
            </button>
          )}
          {!isPdfPages && expanded && (
            <pre className="mt-1 rounded bg-muted/50 p-2 text-[10px] text-muted-foreground overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(event.data, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SubTaskItem ──────────────────────────────────────────────────────────────

function SubTaskItem({ subtask }: { subtask: WorkflowSubTask }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (subtask.status === "running" || subtask.status === "error") {
      setOpen(true);
    }
  }, [subtask.status]);

  const hasEvents = subtask.events.length > 0;

  const rowCount =
    subtask.id === "extract" && subtask.status === "done"
      ? (subtask.events
          .map((ev) => (ev.data as { row_count?: number }).row_count)
          .filter((n): n is number => typeof n === "number")
          .at(-1) ?? null)
      : null;

  return (
    <div className="ml-7">
      <button
        onClick={() => hasEvents && setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left",
          "hover:bg-muted/30 transition-colors",
          !hasEvents && "cursor-default"
        )}
      >
        <TaskStatusIcon status={subtask.status} size="sm" />
        <span
          className={cn(
            "flex-1 font-medium",
            subtask.status === "done" && "text-muted-foreground",
            subtask.status === "skipped" && "text-muted-foreground/60 italic",
            subtask.status === "pending" && "text-muted-foreground/60",
            subtask.status === "running" && "text-foreground",
            subtask.status === "error" && "text-[#F44D4D]"
          )}
        >
          {subtask.label}
          {rowCount !== null && (
            <span className="ml-1.5 font-normal text-muted-foreground/60">
              · {rowCount} rows
            </span>
          )}
        </span>
        {hasEvents && (
          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
            {subtask.events.length}
          </span>
        )}
        {hasEvents &&
          (open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          ))}
      </button>

      {open && hasEvents && (
        <div className="ml-5 mb-1 rounded-md border border-border overflow-hidden">
          {subtask.events.map((ev, i) => (
            <EventRow key={i} event={ev} compact />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TaskItem ─────────────────────────────────────────────────────────────────

function TaskItem({ task, autoExpand }: { task: WorkflowTask; autoExpand?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (task.status === "running" || task.status === "error" || autoExpand) {
      setOpen(true);
    }
  }, [task.status, autoExpand]);

  const statusColors: Record<TaskStatus, string> = {
    running: "border-sky-400/30 bg-sky-400/5",
    done: "border-border",
    error: "border-[#F44D4D]/30 bg-[#F44D4D]/5",
    skipped: "border-border opacity-60",
    pending: "border-border opacity-50",
  };

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden transition-all",
        statusColors[task.status]
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
      >
        <TaskStatusIcon status={task.status} />
        <span
          className={cn(
            "flex-1 text-sm font-medium",
            task.status === "done" && "text-muted-foreground",
            task.status === "pending" && "text-muted-foreground/60",
            task.status === "skipped" && "text-muted-foreground/60 italic",
            task.status === "running" && "text-foreground",
            task.status === "error" && "text-[#F44D4D]"
          )}
        >
          {task.label}
        </span>
        {task.subtasks.length > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {task.subtasks.filter((s) => s.status === "done" || s.status === "skipped").length}/
            {task.subtasks.length}
          </span>
        )}
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && task.subtasks.length > 0 && (
        <div className="pb-1.5 border-t border-border">
          {task.subtasks.map((sub) => (
            <SubTaskItem key={sub.id} subtask={sub} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TaskTreeView ─────────────────────────────────────────────────────────────

function TaskTreeView({
  tasks,
  bottomRef,
}: {
  tasks: WorkflowTask[];
  bottomRef: React.RefObject<HTMLDivElement | null>;
}) {
  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Waiting for first task…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {tasks.map((task, i) => (
        <TaskItem key={task.id} task={task} autoExpand={i === 0} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Config form fields (controlled) ─────────────────────────────────────────

interface ConfigFormFieldsProps {
  includeEmail: boolean;
  onIncludeEmailChange: (v: boolean) => void;
  includeStatement: boolean;
  onIncludeStatementChange: (v: boolean) => void;
  includeSplitwise: boolean;
  onIncludeSplitwiseChange: (v: boolean) => void;
  startDate: string;
  onStartDateChange: (v: string) => void;
  endDate: string;
  onEndDateChange: (v: string) => void;
  swStartDate: string;
  onSwStartDateChange: (v: string) => void;
  swEndDate: string;
  onSwEndDateChange: (v: string) => void;
  secondaryAccount: boolean;
  onSecondaryAccountChange: (v: boolean) => void;
  override: boolean;
  onOverrideChange: (v: boolean) => void;
  periodLoading: boolean;
  periodCheck: WorkflowPeriodCheck | undefined;
}

function ConfigFormFields({
  includeEmail,
  onIncludeEmailChange,
  includeStatement,
  onIncludeStatementChange,
  includeSplitwise,
  onIncludeSplitwiseChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
  swStartDate,
  onSwStartDateChange,
  swEndDate,
  onSwEndDateChange,
  secondaryAccount,
  onSecondaryAccountChange,
  override,
  onOverrideChange,
  periodLoading,
  periodCheck,
}: ConfigFormFieldsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const showEmailDates = includeEmail || includeStatement;
  const showSplitwiseDates = includeSplitwise;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Subsystem toggles ──────────────────────────────────── */}
      <div className="space-y-2">
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          What to run
        </Label>
        <div className="flex flex-col rounded-xl border border-border/40 bg-muted/20 divide-y divide-border/30">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Email ingestion</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Parse bank alert emails for new transactions
              </p>
            </div>
            <Switch
              checked={includeEmail}
              onCheckedChange={onIncludeEmailChange}
              className="data-[state=checked]:bg-primary"
            />
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Statement processing</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Download PDFs, extract and standardize transactions
              </p>
            </div>
            <Switch
              checked={includeStatement}
              onCheckedChange={onIncludeStatementChange}
              className="data-[state=checked]:bg-primary"
            />
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-foreground">Splitwise sync</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Pull shared expenses from Splitwise
              </p>
            </div>
            <Switch
              checked={includeSplitwise}
              onCheckedChange={onIncludeSplitwiseChange}
              className="data-[state=checked]:bg-primary"
            />
          </div>
        </div>
      </div>

      {/* ── Advanced toggle ────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors w-fit"
      >
        <Settings2 className="h-3.5 w-3.5" />
        <span>Advanced options</span>
        {showAdvanced ? (
          <ChevronUp className="h-3 w-3 ml-0.5" />
        ) : (
          <ChevronDown className="h-3 w-3 ml-0.5" />
        )}
      </button>

      {/* ── Advanced panel ─────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {showAdvanced && (
          <motion.div
            key="advanced"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 40 }}
            style={{ overflow: "hidden" }}
          >
            <div className="flex flex-col gap-4 rounded-xl border border-border/40 bg-muted/20 overflow-hidden">
              {/* Toggles */}
              <div className="divide-y divide-border/30">
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Secondary account</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      Enable processing for secondary accounts
                    </p>
                  </div>
                  <Switch
                    checked={secondaryAccount}
                    onCheckedChange={onSecondaryAccountChange}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Override cache</p>
                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                      Bypass GCS resume checks and re-extract
                    </p>
                  </div>
                  <Switch
                    checked={override}
                    onCheckedChange={onOverrideChange}
                    className="data-[state=checked]:bg-primary"
                  />
                </div>
              </div>

              {/* Date ranges */}
              <div className="flex flex-col gap-4 px-4 pb-4">
                {showEmailDates && (
                  <div className="space-y-2">
                    <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Email date range
                      <span className="ml-1 normal-case font-normal text-muted-foreground/40">
                        · optional
                      </span>
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground/50 mb-1.5 block">Start</Label>
                        <Input
                          type="date"
                          value={startDate}
                          onChange={(e) => onStartDateChange(e.target.value)}
                          className="text-sm h-9 bg-card"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground/50 mb-1.5 block">End</Label>
                        <Input
                          type="date"
                          value={endDate}
                          onChange={(e) => onEndDateChange(e.target.value)}
                          className="text-sm h-9 bg-card"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {showSplitwiseDates && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        Splitwise date range
                        <span className="ml-1 normal-case font-normal text-muted-foreground/40">
                          · optional
                        </span>
                      </Label>
                      <p className="text-[11px] text-muted-foreground/40 mt-0.5">
                        Leave blank to auto-detect from last DB record
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs text-muted-foreground/50 mb-1.5 block">Start</Label>
                        <Input
                          type="date"
                          value={swStartDate}
                          onChange={(e) => onSwStartDateChange(e.target.value)}
                          className="text-sm h-9 bg-card"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground/50 mb-1.5 block">End</Label>
                        <Input
                          type="date"
                          value={swEndDate}
                          onChange={(e) => onSwEndDateChange(e.target.value)}
                          className="text-sm h-9 bg-card"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Last run summary ───────────────────────────────────────── */}
      {periodLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking period status…
        </div>
      )}
      {/* TODO: replace STUB_LAST_RUN with real API data once endpoint exists */}
      <LastRunCard
        run={STUB_LAST_RUN}
        periodCheck={!periodLoading && periodCheck && periodCheck.total > 0 ? periodCheck : undefined}
      />
    </div>
  );
}

// ─── Live log panel ───────────────────────────────────────────────────────────

interface LiveLogProps {
  jobId: string;
  onStatusChange: (status: WorkflowJobStatus) => void;
  onProgressChange: (pct: number) => void;
}

function LiveLog({ jobId, onStatusChange, onProgressChange }: LiveLogProps) {
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [view, setView] = useState<"tasks" | "log">("tasks");
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleEvent = useCallback((event: WorkflowEvent) => {
    setEvents((prev) => [...prev, event]);
    if (event.event === "workflow_complete") onStatusChange("completed");
    else if (event.event === "workflow_error") onStatusChange("failed");
    else if (event.event === "workflow_cancelled") onStatusChange("cancelled");
    else if (event.event === "workflow_started") onStatusChange("running");
  }, [onStatusChange]);

  useWorkflowStream(jobId, handleEvent);

  const tasks = useMemo(() => buildTaskTree(events), [events]);

  // Report progress to parent
  useEffect(() => {
    if (tasks.length === 0) return;
    const done = tasks.filter(
      (t) => t.status === "done" || t.status === "skipped" || t.status === "error"
    ).length;
    onProgressChange(done / tasks.length);
  }, [tasks, onProgressChange]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length, tasks.length]);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between shrink-0">
        <span className="text-xs text-muted-foreground">
          {view === "tasks"
            ? `${tasks.length} task${tasks.length !== 1 ? "s" : ""}`
            : `${events.length} event${events.length !== 1 ? "s" : ""}`}
        </span>

        {/* View toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          <button
            onClick={() => setView("tasks")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 transition-colors",
              view === "tasks"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <ListTree className="h-3.5 w-3.5" />
            Tasks
          </button>
          <button
            onClick={() => setView("log")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 transition-colors border-l border-border",
              view === "log"
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="h-3.5 w-3.5" />
            Log
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {view === "tasks" ? (
          <TaskTreeView tasks={tasks} bottomRef={bottomRef} />
        ) : (
          <div className="rounded-md border border-border bg-card text-xs">
            {events.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Waiting for events…
              </div>
            ) : (
              events.map((ev, i) => <EventRow key={i} event={ev} />)
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main sheet ───────────────────────────────────────────────────────────────

interface ActiveJob {
  jobId: string;
  startedAt: string;
}

export function WorkflowSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Config state
  const [includeEmail, setIncludeEmail] = useState(true);
  const [includeStatement, setIncludeStatement] = useState(true);
  const [includeSplitwise, setIncludeSplitwise] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [swStartDate, setSwStartDate] = useState("");
  const [swEndDate, setSwEndDate] = useState("");
  const [secondaryAccount, setSecondaryAccount] = useState(false);
  const [override, setOverride] = useState(false);

  // Live job state
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [jobStatus, setJobStatus] = useState<WorkflowJobStatus>("pending");
  const [progressPct, setProgressPct] = useState(0);

  const { mutate: startWorkflow, isPending } = useStartWorkflow();
  const { mutate: cancelWorkflow, isPending: isCancelling } = useCancelWorkflow();
  const { data: periodCheck, isLoading: periodLoading } = useWorkflowPeriodCheck();

  const isTerminal = ["completed", "failed", "cancelled"].includes(jobStatus);
  const noSubsystemSelected = !includeEmail && !includeStatement && !includeSplitwise;

  const handleStart = () => {
    startWorkflow(
      {
        mode: "full",
        start_date: startDate || null,
        end_date: endDate || null,
        splitwise_start_date: swStartDate || null,
        splitwise_end_date: swEndDate || null,
        enable_secondary_account: secondaryAccount || null,
        override,
        include_email_ingestion: includeEmail,
        include_statement: includeStatement,
        include_splitwise: includeSplitwise,
      },
      {
        onSuccess: (data) => {
          setJobStatus("pending");
          setProgressPct(0);
          setActiveJob({
            jobId: data.job_id,
            startedAt: new Date().toISOString(),
          });
        },
      }
    );
  };

  const handleCancel = () => {
    if (activeJob) cancelWorkflow(activeJob.jobId);
  };

  const handleReset = () => {
    setActiveJob(null);
    setJobStatus("pending");
    setProgressPct(0);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setActiveJob(null);
      setJobStatus("pending");
      setProgressPct(0);
      setExpanded(false);
    }
    onOpenChange(next);
  };

  const handleStatusChange = useCallback((status: WorkflowJobStatus) => {
    setJobStatus(status);
  }, []);

  const handleProgressChange = useCallback((pct: number) => {
    setProgressPct(pct);
  }, []);

  // Subtitle text
  const subtitle = activeJob
    ? `Started ${format(new Date(activeJob.startedAt), "HH:mm")}`
    : "Configure and start a statement processing run";

  // Progress bar width: when terminal, go to 100%
  const barPct = isTerminal ? 100 : progressPct * 100;
  const barColor =
    jobStatus === "completed"
      ? "bg-emerald-400"
      : jobStatus === "failed"
      ? "bg-[#F44D4D]"
      : jobStatus === "cancelled"
      ? "bg-amber-400"
      : "bg-primary";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className={cn(
          "flex flex-col max-w-full sm:max-w-full p-0 transition-[width] duration-200",
          expanded ? "w-[860px]" : "w-[520px]"
        )}
      >
        {/* ── Fixed header ───────────────────────────────────────────── */}
        <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-start justify-between">
            <SheetHeader className="flex-1 min-w-0">
              <SheetTitle className="flex items-center gap-2">
                <Play className="h-4 w-4 text-emerald-400 fill-current shrink-0" />
                Run Workflow
              </SheetTitle>
              <SheetDescription>{subtitle}</SheetDescription>
            </SheetHeader>
            <div className="flex items-center gap-0.5 shrink-0 ml-2 -mt-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? "Collapse panel" : "Expand panel"}
              >
                {expanded ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </Button>
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  title="Close panel"
                >
                  <X className="h-4 w-4" />
                </Button>
              </SheetClose>
            </div>
          </div>
        </div>

        {/* ── Progress strip (live mode only) ────────────────────────── */}
        <div
          className={cn(
            "h-0.5 w-full shrink-0 bg-muted/30 overflow-hidden transition-opacity duration-300",
            activeJob ? "opacity-100" : "opacity-0"
          )}
        >
          <motion.div
            className={cn("h-full rounded-full", barColor)}
            animate={{ width: `${barPct}%` }}
            transition={{ type: "spring", stiffness: 60, damping: 20 }}
          />
        </div>

        {/* ── Scrollable body ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <AnimatePresence mode="wait">
            {!activeJob ? (
              <motion.div
                key="config"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <ConfigFormFields
                  includeEmail={includeEmail}
                  onIncludeEmailChange={setIncludeEmail}
                  includeStatement={includeStatement}
                  onIncludeStatementChange={setIncludeStatement}
                  includeSplitwise={includeSplitwise}
                  onIncludeSplitwiseChange={setIncludeSplitwise}
                  startDate={startDate}
                  onStartDateChange={setStartDate}
                  endDate={endDate}
                  onEndDateChange={setEndDate}
                  swStartDate={swStartDate}
                  onSwStartDateChange={setSwStartDate}
                  swEndDate={swEndDate}
                  onSwEndDateChange={setSwEndDate}
                  secondaryAccount={secondaryAccount}
                  onSecondaryAccountChange={setSecondaryAccount}
                  override={override}
                  onOverrideChange={setOverride}
                  periodLoading={periodLoading}
                  periodCheck={periodCheck}
                />
              </motion.div>
            ) : (
              <motion.div
                key="live"
                className="h-full"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
                style={{ minHeight: "100%" }}
              >
                <LiveLog
                  jobId={activeJob.jobId}
                  onStatusChange={handleStatusChange}
                  onProgressChange={handleProgressChange}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Sticky footer ───────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-border px-6 py-4">
          <AnimatePresence mode="wait">
            {!activeJob ? (
              <motion.div
                key="run"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <Button
                  onClick={handleStart}
                  disabled={isPending || noSubsystemSelected}
                  className="w-full gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  {isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 fill-current" />
                  )}
                  {isPending ? "Starting…" : "Run Workflow"}
                </Button>
              </motion.div>
            ) : isTerminal ? (
              <motion.div
                key="run-again"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex gap-2"
              >
                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="flex-1 gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Run again
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="stop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
              >
                <Button
                  variant="outline"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  className="w-full gap-1.5 text-[#F44D4D] border-[#F44D4D]/30 hover:bg-[#F44D4D]/10 hover:text-[#F44D4D]"
                >
                  {isCancelling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Square className="h-3.5 w-3.5 fill-current" />
                  )}
                  Stop
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </SheetContent>
    </Sheet>
  );
}
