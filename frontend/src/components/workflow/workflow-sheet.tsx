"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  WorkflowMode,
} from "@/lib/api/types/workflow";
import {
  buildTaskTree,
  type TaskStatus,
  type WorkflowSubTask,
  type WorkflowTask,
} from "@/lib/workflow-tasks";

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

// ─── Single event row (used in both flat log and subtask expansion) ───────────

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
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums font-mono">{ts}</span>
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

  // Auto-expand when running or when it errors
  useEffect(() => {
    if (subtask.status === "running" || subtask.status === "error") {
      setOpen(true);
    }
  }, [subtask.status]);

  const hasEvents = subtask.events.length > 0;

  // Show row count for the extract subtask when done
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
        {hasEvents && (
          open ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )
        )}
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

  // Auto-open when this task becomes active or errors
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
      {/* Task header */}
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

      {/* Subtasks */}
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

// ─── Config form ──────────────────────────────────────────────────────────────

interface ConfigFormProps {
  onStart: (jobId: string) => void;
}

function ConfigForm({ onStart }: ConfigFormProps) {
  const [mode, setMode] = useState<WorkflowMode>("full");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [swStartDate, setSwStartDate] = useState("");
  const [swEndDate, setSwEndDate] = useState("");
  const [secondaryAccount, setSecondaryAccount] = useState(false);
  const [override, setOverride] = useState(false);

  const { mutate: startWorkflow, isPending } = useStartWorkflow();
  const { data: periodCheck, isLoading: periodLoading } = useWorkflowPeriodCheck();

  const handleStart = () => {
    startWorkflow(
      {
        mode,
        start_date: startDate || null,
        end_date: endDate || null,
        splitwise_start_date: swStartDate || null,
        splitwise_end_date: swEndDate || null,
        enable_secondary_account: secondaryAccount || null,
        override,
      },
      {
        onSuccess: (data) => onStart(data.job_id),
      }
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Mode */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Mode</Label>
        <Select value={mode} onValueChange={(v) => setMode(v as WorkflowMode)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="full">Full — download + extract + Splitwise</SelectItem>
            <SelectItem value="resume">Resume — skip extraction, re-standardize</SelectItem>
            <SelectItem value="splitwise_only">Splitwise only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Email date range */}
      {mode !== "splitwise_only" && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Email date range (optional)</Label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Start</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">End</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* Splitwise date range */}
      {mode !== "resume" && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Splitwise date range (optional)</Label>
          <p className="text-xs text-muted-foreground">Leave blank to auto-detect from last DB record</p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Start</Label>
              <Input
                type="date"
                value={swStartDate}
                onChange={(e) => setSwStartDate(e.target.value)}
                className="text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">End</Label>
              <Input
                type="date"
                value={swEndDate}
                onChange={(e) => setSwEndDate(e.target.value)}
                className="text-sm"
              />
            </div>
          </div>
        </div>
      )}

      {/* Toggles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Secondary account</Label>
            <p className="text-xs text-muted-foreground">Enable processing for secondary accounts</p>
          </div>
          <Switch
            checked={secondaryAccount}
            onCheckedChange={setSecondaryAccount}
            className="data-[state=checked]:bg-primary"
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Override cache</Label>
            <p className="text-xs text-muted-foreground">Bypass GCS resume checks and re-extract</p>
          </div>
          <Switch
            checked={override}
            onCheckedChange={setOverride}
            className="data-[state=checked]:bg-primary"
          />
        </div>
      </div>

      {/* Readiness banner */}
      {periodLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking period status…
        </div>
      )}

      {!periodLoading && periodCheck && periodCheck.total > 0 && (
        <>
          {periodCheck.all_done && (
            <div className="rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 flex gap-2.5">
              <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
              <div className="text-xs text-amber-300">
                <p className="font-medium">Already fully processed for {periodCheck.month}</p>
                <p className="mt-0.5 text-amber-300/70">
                  All {periodCheck.total} statements are complete. Enable{" "}
                  <span className="font-medium text-amber-300">Override cache</span> below to force re-extraction.
                </p>
              </div>
            </div>
          )}

          {periodCheck.has_partial && (
            <div className="rounded-md border border-sky-400/30 bg-sky-400/10 px-3 py-2.5 flex gap-2.5">
              <Info className="h-4 w-4 shrink-0 text-sky-400 mt-0.5" />
              <div className="text-xs text-sky-300">
                <p className="font-medium">
                  Previous run was incomplete — {periodCheck.complete}/{periodCheck.total} done for {periodCheck.month}
                </p>
                <p className="mt-0.5 text-sky-300/70">
                  {periodCheck.incomplete.length} statement{periodCheck.incomplete.length !== 1 ? "s" : ""} will be
                  picked up automatically:{" "}
                  {periodCheck.incomplete
                    .map((s) => s.account_nickname ?? s.normalized_filename)
                    .join(", ")}
                  .
                </p>
              </div>
            </div>
          )}
        </>
      )}

      <Button
        onClick={handleStart}
        disabled={isPending}
        className="w-full gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4 fill-current" />
        )}
        {isPending ? "Starting…" : "Run Workflow"}
      </Button>
    </div>
  );
}

// ─── Live log panel ───────────────────────────────────────────────────────────

interface LiveLogProps {
  jobId: string;
  onReset: () => void;
}

function LiveLog({ jobId, onReset }: LiveLogProps) {
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [status, setStatus] = useState<WorkflowJobStatus>("pending");
  const [view, setView] = useState<"tasks" | "log">("tasks");
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleEvent = useCallback((event: WorkflowEvent) => {
    setEvents((prev) => [...prev, event]);
    if (event.event === "workflow_complete") setStatus("completed");
    else if (event.event === "workflow_error") setStatus("failed");
    else if (event.event === "workflow_cancelled") setStatus("cancelled");
    else if (event.event === "workflow_started") setStatus("running");
  }, []);

  useWorkflowStream(jobId, handleEvent);

  // Build task tree from events
  const tasks = useMemo(() => buildTaskTree(events), [events]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length, tasks.length]);

  const { mutate: cancelWorkflow, isPending: isCancelling } = useCancelWorkflow();
  const handleCancel = () => cancelWorkflow(jobId);
  const isTerminal = ["completed", "failed", "cancelled"].includes(status);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          <span className="text-xs text-muted-foreground">
            {view === "tasks"
              ? `${tasks.length} task${tasks.length !== 1 ? "s" : ""}`
              : `${events.length} events`}
          </span>
        </div>
        <div className="flex gap-1.5">
          {/* View toggle */}
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            <button
              onClick={() => setView("tasks")}
              className={cn(
                "flex items-center gap-1 px-2 py-1 transition-colors",
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
                "flex items-center gap-1 px-2 py-1 transition-colors",
                view === "log"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="h-3.5 w-3.5" />
              Log
            </button>
          </div>

          {!isTerminal && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={isCancelling}
              className="gap-1.5 text-[#F44D4D] border-[#F44D4D]/30 hover:bg-[#F44D4D]/10 hover:text-[#F44D4D]"
            >
              {isCancelling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5 fill-current" />
              )}
              Stop
            </Button>
          )}
          {isTerminal && (
            <Button variant="outline" size="sm" onClick={onReset} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Run again
            </Button>
          )}
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

export function WorkflowSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const handleStart = (jobId: string) => setActiveJobId(jobId);
  const handleReset = () => setActiveJobId(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setActiveJobId(null);
      setExpanded(false);
    }
    onOpenChange(next);
  };

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
        {/* Fixed header */}
        <div className="shrink-0 px-6 pt-5 pb-4 border-b border-border">
          <div className="flex items-start justify-between">
            <SheetHeader className="flex-1 min-w-0">
              <SheetTitle className="flex items-center gap-2">
                <Play className="h-4 w-4 text-emerald-400 fill-current shrink-0" />
                Run Workflow
              </SheetTitle>
              <SheetDescription>
                {activeJobId
                  ? `Job ${activeJobId.slice(0, 8)}… — live event stream`
                  : "Configure and start a statement processing run"}
              </SheetDescription>
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

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeJobId ? (
            <LiveLog jobId={activeJobId} onReset={handleReset} />
          ) : (
            <ConfigForm onStart={handleStart} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
