"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Layout/Navbar";

interface SelectedHour {
  dateKey: string;
  dayLabel: string;
  hour: number;
}

interface CalendarSegment {
  id: string;
  startMinute: number;
  endMinute: number;
  note: string;
  completed: boolean;
}

interface CalendarBlock {
  id: string;
  dateKey: string;
  title: string;
  startMinute: number;
  endMinute: number;
  note: string;
  color: string;
  completed: boolean;
  segments: CalendarSegment[];
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const HOUR_HEIGHT = 64;
const DAY_HEIGHT = HOURS.length * HOUR_HEIGHT;
const TIME_OPTIONS = Array.from({ length: 289 }, (_, index) => index * 5);
const BLOCK_COLORS = [
  { label: "Blue", value: "#2563eb" },
  { label: "Sky", value: "#0284c7" },
  { label: "Cyan", value: "#0891b2" },
  { label: "Teal", value: "#0f766e" },
  { label: "Green", value: "#16a34a" },
  { label: "Lime", value: "#65a30d" },
  { label: "Yellow", value: "#ca8a04" },
  { label: "Amber", value: "#d97706" },
  { label: "Orange", value: "#ea580c" },
  { label: "Red", value: "#dc2626" },
  { label: "Rose", value: "#e11d48" },
  { label: "Pink", value: "#db2777" },
  { label: "Fuchsia", value: "#c026d3" },
  { label: "Violet", value: "#7c3aed" },
  { label: "Indigo", value: "#4f46e5" },
  { label: "Slate", value: "#475569" },
];

const DAY_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const WEEK_RANGE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + mondayOffset);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `calendar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatMinuteOfDay(minuteOfDay: number): string {
  if (minuteOfDay >= 1440) return "24:00";
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clampTime(value: number): number {
  return Math.max(0, Math.min(1440, Math.trunc(value)));
}

function createSegment(startMinute: number, endMinute: number): CalendarSegment {
  return {
    id: createId(),
    startMinute,
    endMinute,
    note: "",
    completed: false,
  };
}

function normalizeSegment(
  segment: CalendarSegment,
  blockStart: number,
  blockEnd: number,
  updates?: Partial<Omit<CalendarSegment, "id">>
): CalendarSegment {
  const next = { ...segment, ...updates };
  next.startMinute = Math.max(blockStart, Math.min(blockEnd - 5, clampTime(next.startMinute)));
  next.endMinute = Math.max(blockStart + 5, Math.min(blockEnd, clampTime(next.endMinute)));
  if (next.endMinute <= next.startMinute) {
    if (updates?.startMinute !== undefined) {
      next.endMinute = Math.min(blockEnd, next.startMinute + 5);
    } else {
      next.startMinute = Math.max(blockStart, next.endMinute - 5);
    }
  }
  return next;
}

function normalizeBlockUpdate(
  block: CalendarBlock,
  updates: Partial<Omit<CalendarBlock, "id" | "dateKey" | "segments">>
): CalendarBlock {
  const next = { ...block, ...updates };
  next.startMinute = Math.max(0, Math.min(1435, clampTime(next.startMinute)));
  next.endMinute = Math.max(5, Math.min(1440, clampTime(next.endMinute)));
  if (next.endMinute <= next.startMinute) {
    if (updates.startMinute !== undefined) {
      next.endMinute = Math.min(1440, next.startMinute + 5);
    } else {
      next.startMinute = Math.max(0, next.endMinute - 5);
    }
  }
  next.segments =
    block.segments.length > 0
      ? block.segments
          .map((segment) => normalizeSegment(segment, next.startMinute, next.endMinute))
          .sort((a, b) => a.startMinute - b.startMinute)
      : [createSegment(next.startMinute, next.endMinute)];
  return next;
}

function createBlock(dateKey: string, startMinute: number): CalendarBlock {
  const safeStart = Math.max(0, Math.min(1435, startMinute));
  const safeEnd = Math.min(1440, safeStart + 60);
  return {
    id: createId(),
    dateKey,
    title: "",
    startMinute: safeStart,
    endMinute: safeEnd,
    note: "",
    color: BLOCK_COLORS[0].value,
    completed: false,
    segments: [createSegment(safeStart, safeEnd)],
  };
}

function blockOverlapsHour(block: CalendarBlock, hour: number): boolean {
  const hourStart = hour * 60;
  const hourEnd = hourStart + 60;
  return block.startMinute < hourEnd && block.endMinute > hourStart;
}

function blockPosition(block: CalendarBlock): { top: number; height: number } {
  const top = (block.startMinute / 60) * HOUR_HEIGHT;
  const height = Math.max(28, ((block.endMinute - block.startMinute) / 60) * HOUR_HEIGHT - 4);
  return { top, height };
}

function timeOptionsBetween(start: number, end: number): number[] {
  return TIME_OPTIONS.filter((minute) => minute >= start && minute <= end);
}

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [selectedHour, setSelectedHour] = useState<SelectedHour | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingError, setSavingError] = useState("");

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(weekStart, index);
        return {
          date,
          key: toDateKey(date),
          label: DAY_FORMATTER.format(date),
          isToday: toDateKey(date) === toDateKey(new Date()),
        };
      }),
    [weekStart]
  );

  const weekEnd = days[6].date;
  const weekLabel = `${WEEK_RANGE_FORMATTER.format(weekStart)} - ${WEEK_RANGE_FORMATTER.format(
    weekEnd
  )}`;
  const activeBlocks = selectedHour
    ? blocks
        .filter(
          (block) =>
            block.dateKey === selectedHour.dateKey &&
            blockOverlapsHour(block, selectedHour.hour)
        )
        .sort((a, b) => a.startMinute - b.startMinute)
    : [];

  useEffect(() => {
    let cancelled = false;

    async function loadCalendar() {
      setLoading(true);
      setSavingError("");
      try {
        const res = await fetch(
          `/api/calendar?weekStart=${encodeURIComponent(toDateKey(weekStart))}`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data.error === "string" ? data.error : "Failed to load calendar"
          );
        }
        if (!cancelled) {
          setBlocks(Array.isArray(data.blocks) ? data.blocks : []);
        }
      } catch (err) {
        if (!cancelled) {
          setSavingError(err instanceof Error ? err.message : "Failed to load calendar");
          setBlocks([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadCalendar();
    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  function moveWeek(offset: number) {
    setWeekStart((current) => addDays(current, offset * 7));
    setSelectedHour(null);
  }

  function openHour(nextSelectedHour: SelectedHour) {
    setSelectedHour(nextSelectedHour);
  }

  async function addBlock() {
    if (!selectedHour) return;
    setSavingError("");
    const draft = createBlock(selectedHour.dateKey, selectedHour.hour * 60);
    try {
      const res = await fetch("/api/calendar/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to add block"
        );
      }
      setBlocks((current) => [...current, data as CalendarBlock]);
    } catch (err) {
      setSavingError(err instanceof Error ? err.message : "Failed to add block");
    }
  }

  function updateBlockLocal(
    blockId: string,
    updates: Partial<Omit<CalendarBlock, "id" | "dateKey" | "segments">>
  ) {
    setBlocks((current) =>
      current.map((block) =>
        block.id === blockId ? normalizeBlockUpdate(block, updates) : block
      )
    );
  }

  async function persistBlock(
    blockId: string,
    updates: Partial<Omit<CalendarBlock, "id" | "dateKey" | "segments">>
  ) {
    setSavingError("");
    try {
      const res = await fetch("/api/calendar/blocks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: blockId, ...updates }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to save block"
        );
      }
    } catch (err) {
      setSavingError(err instanceof Error ? err.message : "Failed to save block");
    }
  }

  function updateBlock(
    blockId: string,
    updates: Partial<Omit<CalendarBlock, "id" | "dateKey" | "segments">>
  ) {
    updateBlockLocal(blockId, updates);
    void persistBlock(blockId, updates);
  }

  async function removeBlock(blockId: string) {
    setSavingError("");
    const previous = blocks;
    setBlocks((current) => current.filter((block) => block.id !== blockId));
    try {
      const res = await fetch("/api/calendar/blocks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: blockId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to remove block"
        );
      }
    } catch (err) {
      setBlocks(previous);
      setSavingError(err instanceof Error ? err.message : "Failed to remove block");
    }
  }

  async function addSegment(blockId: string) {
    const block = blocks.find((item) => item.id === blockId);
    if (!block) return;
    setSavingError("");
    const latestEnd = Math.max(...block.segments.map((segment) => segment.endMinute));
    const startMinute = latestEnd >= block.endMinute ? block.startMinute : latestEnd;
    const endMinute = Math.min(block.endMinute, startMinute + 30);
    try {
      const res = await fetch("/api/calendar/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blockId,
          startMinute,
          endMinute,
          note: "",
          completed: false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to add segment"
        );
      }
      setBlocks((current) =>
        current.map((item) =>
          item.id === blockId
            ? {
                ...item,
                segments: [...item.segments, data as CalendarSegment].sort(
                  (a, b) => a.startMinute - b.startMinute
                ),
              }
            : item
        )
      );
    } catch (err) {
      setSavingError(err instanceof Error ? err.message : "Failed to add segment");
    }
  }

  function updateSegmentLocal(
    blockId: string,
    segmentId: string,
    updates: Partial<Omit<CalendarSegment, "id">>
  ) {
    setBlocks((current) =>
      current.map((block) => {
        if (block.id !== blockId) return block;
        return {
          ...block,
          segments: block.segments
            .map((segment) =>
              segment.id === segmentId
                ? normalizeSegment(segment, block.startMinute, block.endMinute, updates)
                : segment
            )
            .sort((a, b) => a.startMinute - b.startMinute),
        };
      })
    );
  }

  async function persistSegment(
    segmentId: string,
    updates: Partial<Omit<CalendarSegment, "id">>
  ) {
    setSavingError("");
    try {
      const res = await fetch("/api/calendar/segments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: segmentId, ...updates }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to save segment"
        );
      }
    } catch (err) {
      setSavingError(err instanceof Error ? err.message : "Failed to save segment");
    }
  }

  function updateSegment(
    blockId: string,
    segmentId: string,
    updates: Partial<Omit<CalendarSegment, "id">>
  ) {
    updateSegmentLocal(blockId, segmentId, updates);
    void persistSegment(segmentId, updates);
  }

  async function removeSegment(blockId: string, segmentId: string) {
    setSavingError("");
    const previous = blocks;
    setBlocks((current) =>
      current.map((block) => {
        if (block.id !== blockId) return block;
        const nextSegments = block.segments.filter((segment) => segment.id !== segmentId);
        return {
          ...block,
          segments:
            nextSegments.length > 0
              ? nextSegments
              : [createSegment(block.startMinute, block.endMinute)],
        };
      })
    );
    try {
      const res = await fetch("/api/calendar/segments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: segmentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : "Failed to remove segment"
        );
      }
    } catch (err) {
      setBlocks(previous);
      setSavingError(err instanceof Error ? err.message : "Failed to remove segment");
    }
  }

  function handleTouchEnd(x: number) {
    if (touchStartX === null) return;
    const delta = x - touchStartX;
    setTouchStartX(null);
    if (Math.abs(delta) < 70) return;
    moveWeek(delta < 0 ? 1 : -1);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <main className="h-[calc(100vh-64px)] min-h-[720px] flex flex-col">
        <header className="border-b border-gray-800 bg-gray-950/95 px-4 py-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-semibold">Calendar</h1>
              <p className="text-sm text-gray-400">
                {weekLabel}
                {loading ? " · Loading..." : ""}
              </p>
              {savingError ? (
                <p className="mt-1 text-sm text-red-300">{savingError}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => moveWeek(-1)}
                className="h-9 px-3 rounded-md border border-gray-700 bg-gray-900 text-sm text-gray-200 hover:border-gray-500"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => {
                  setWeekStart(startOfWeek(new Date()));
                  setSelectedHour(null);
                }}
                className="h-9 px-3 rounded-md border border-gray-700 bg-gray-900 text-sm text-gray-200 hover:border-gray-500"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => moveWeek(1)}
                className="h-9 px-3 rounded-md border border-gray-700 bg-gray-900 text-sm text-gray-200 hover:border-gray-500"
              >
                Next
              </button>
            </div>
          </div>
        </header>

        <section
          className="flex-1 overflow-auto"
          onTouchStart={(event) => setTouchStartX(event.touches[0]?.clientX ?? null)}
          onTouchEnd={(event) =>
            handleTouchEnd(event.changedTouches[0]?.clientX ?? touchStartX ?? 0)
          }
        >
          <div className="min-w-[1040px]">
            <div className="sticky top-0 z-30 grid grid-cols-[72px_repeat(7,minmax(132px,1fr))] border-b border-gray-800 bg-gray-950">
              <div className="border-r border-gray-800 px-3 py-3 text-xs uppercase text-gray-500">
                Time
              </div>
              {days.map((day) => (
                <div
                  key={day.key}
                  className={`border-r border-gray-800 px-3 py-3 ${
                    day.isToday ? "bg-cyan-950/30" : ""
                  }`}
                >
                  <p className="text-sm font-medium text-gray-100">{day.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{day.key}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-[72px_repeat(7,minmax(132px,1fr))]">
              <div className="relative border-r border-gray-800 bg-gray-950" style={{ height: DAY_HEIGHT }}>
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-b border-gray-800 px-3 py-2 text-xs text-gray-500"
                    style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  >
                    {formatHour(hour)}
                  </div>
                ))}
              </div>

              {days.map((day) => {
                const dayBlocks = blocks
                  .filter((block) => block.dateKey === day.key)
                  .sort((a, b) => a.startMinute - b.startMinute);

                return (
                  <div
                    key={day.key}
                    className={`relative border-r border-gray-800 ${
                      day.isToday ? "bg-cyan-950/10" : "bg-gray-950"
                    }`}
                    style={{ height: DAY_HEIGHT }}
                  >
                    {HOURS.map((hour) => {
                      const isSelected =
                        selectedHour?.dateKey === day.key && selectedHour.hour === hour;
                      return (
                        <button
                          type="button"
                          key={`${day.key}-${hour}`}
                          onClick={() =>
                            openHour({
                              dateKey: day.key,
                              dayLabel: day.label,
                              hour,
                            })
                          }
                          className={`absolute left-0 right-0 border-b border-gray-800 text-left transition-colors hover:bg-gray-900/80 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-inset ${
                            isSelected ? "bg-cyan-950/40" : ""
                          }`}
                          style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                          aria-label={`${day.label} ${formatHour(hour)}`}
                        />
                      );
                    })}

                    {dayBlocks.map((block) => {
                      const position = blockPosition(block);
                      return (
                        <button
                          type="button"
                          key={block.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            openHour({
                              dateKey: day.key,
                              dayLabel: day.label,
                              hour: Math.min(23, Math.floor(block.startMinute / 60)),
                            });
                          }}
                          className="absolute left-1 right-1 z-10 rounded-md border px-2 py-1 text-left shadow-md shadow-black/30 focus:outline-none focus:ring-2 focus:ring-white/70"
                          style={{
                            top: position.top,
                            height: position.height,
                            backgroundColor: `${block.color}dd`,
                            borderColor: block.color,
                          }}
                        >
                          <div className="flex items-start gap-1.5">
                            <span
                              className={`mt-0.5 inline-block h-3 w-3 rounded-sm border border-white/80 bg-white/20 ${
                                block.completed ? "bg-white" : ""
                              }`}
                            />
                            <div className="min-w-0">
                              <p
                                className={`truncate text-xs font-semibold text-white ${
                                  block.completed ? "line-through opacity-75" : ""
                                }`}
                              >
                                {block.title.trim() || "Untitled block"}
                              </p>
                              <p
                                className={`truncate text-[11px] text-white/90 ${
                                  block.completed ? "line-through opacity-70" : ""
                                }`}
                              >
                                {formatMinuteOfDay(block.startMinute)} -{" "}
                                {formatMinuteOfDay(block.endMinute)}
                              </p>
                              <p className="mt-0.5 truncate text-[11px] text-white/80">
                                {block.segments.length} segment
                                {block.segments.length === 1 ? "" : "s"}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {selectedHour ? (
        <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-gray-800 bg-gray-950 shadow-2xl shadow-black/50">
          <div className="border-b border-gray-800 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-gray-400">{selectedHour.dayLabel}</p>
                <h2 className="text-lg font-semibold">
                  {formatHour(selectedHour.hour)} - {formatHour((selectedHour.hour + 1) % 24)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedHour(null)}
                className="h-9 w-9 rounded-md border border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500"
                aria-label="Close block editor"
              >
                x
              </button>
            </div>
          </div>

          <div className="border-b border-gray-800 px-5 py-4">
            <button
              type="button"
              onClick={addBlock}
              className="h-10 rounded-md bg-cyan-600 px-4 text-sm font-medium text-white hover:bg-cyan-500"
            >
              Add block
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {activeBlocks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/40 p-4 text-sm text-gray-400">
                No block overlaps this hour yet.
              </div>
            ) : null}

            <div className="space-y-3">
              {activeBlocks.map((block) => (
                <div
                  key={block.id}
                  className="rounded-lg border border-gray-800 bg-gray-900/70 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm text-gray-200">
                      <input
                        type="checkbox"
                        checked={block.completed}
                        onChange={(event) =>
                          updateBlock(block.id, { completed: event.target.checked })
                        }
                        className="h-4 w-4 rounded border-gray-700 bg-gray-950 accent-cyan-500"
                      />
                      Completed
                    </label>
                    <button
                      type="button"
                      onClick={() => removeBlock(block.id)}
                      className="h-9 rounded-md border border-gray-700 px-3 text-sm text-gray-300 hover:border-red-400 hover:text-red-200"
                    >
                      Remove block
                    </button>
                  </div>

                  <label className="mt-3 block text-sm text-gray-300">
                    Block title
                    <input
                      type="text"
                      value={block.title}
                      onChange={(event) => updateBlock(block.id, { title: event.target.value })}
                      placeholder="Study"
                      className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-white outline-none placeholder:text-gray-600 focus:border-cyan-400"
                    />
                  </label>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="block text-sm text-gray-300">
                      Block start
                      <select
                        value={block.startMinute}
                        onChange={(event) =>
                          updateBlock(block.id, {
                            startMinute: Number(event.target.value),
                          })
                        }
                        className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-white outline-none focus:border-cyan-400"
                      >
                        {TIME_OPTIONS.slice(0, -1).map((minute) => (
                          <option key={minute} value={minute}>
                            {formatMinuteOfDay(minute)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-sm text-gray-300">
                      Block end
                      <select
                        value={block.endMinute}
                        onChange={(event) =>
                          updateBlock(block.id, {
                            endMinute: Number(event.target.value),
                          })
                        }
                        className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-white outline-none focus:border-cyan-400"
                      >
                        {TIME_OPTIONS.slice(1).map((minute) => (
                          <option key={minute} value={minute}>
                            {formatMinuteOfDay(minute)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-3">
                    <p className="text-sm text-gray-300">Color</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {BLOCK_COLORS.map((color) => (
                        <button
                          type="button"
                          key={color.value}
                          onClick={() => updateBlock(block.id, { color: color.value })}
                          className={`h-6 w-6 rounded-full border-2 ${
                            block.color === color.value
                              ? "border-white"
                              : "border-transparent"
                          }`}
                          style={{ backgroundColor: color.value }}
                          aria-label={color.label}
                        />
                      ))}
                    </div>
                  </div>

                  <textarea
                    value={block.note}
                    onChange={(event) => updateBlock(block.id, { note: event.target.value })}
                    rows={3}
                    placeholder="Overall block notes..."
                    className={`mt-3 min-h-20 w-full resize-y rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm leading-relaxed text-gray-100 outline-none placeholder:text-gray-600 focus:border-cyan-400 ${
                      block.completed ? "line-through opacity-75" : ""
                    }`}
                  />

                  <div className="mt-4 border-t border-gray-800 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold text-gray-100">Segments</h3>
                      <button
                        type="button"
                        onClick={() => addSegment(block.id)}
                        className="h-9 rounded-md border border-gray-700 px-3 text-sm text-gray-200 hover:border-gray-500"
                      >
                        Add segment
                      </button>
                    </div>

                    <div className="mt-3 space-y-3">
                      {block.segments.map((segment) => {
                        const startOptions = timeOptionsBetween(
                          block.startMinute,
                          block.endMinute - 5
                        );
                        const endOptions = timeOptionsBetween(
                          block.startMinute + 5,
                          block.endMinute
                        );

                        return (
                          <div
                            key={segment.id}
                            className="rounded-md border border-gray-800 bg-gray-950/70 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <label className="flex items-center gap-2 text-sm text-gray-200">
                                <input
                                  type="checkbox"
                                  checked={segment.completed}
                                  onChange={(event) =>
                                    updateSegment(block.id, segment.id, {
                                      completed: event.target.checked,
                                    })
                                  }
                                  className="h-4 w-4 rounded border-gray-700 bg-gray-950 accent-cyan-500"
                                />
                                Segment done
                              </label>

                              <button
                                type="button"
                                onClick={() => removeSegment(block.id, segment.id)}
                                className="h-9 rounded-md border border-gray-700 px-3 text-sm text-gray-300 hover:border-red-400 hover:text-red-200"
                              >
                                Remove
                              </button>
                            </div>

                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              <label className="block text-sm text-gray-300">
                                Start
                                <select
                                  value={segment.startMinute}
                                  onChange={(event) =>
                                    updateSegment(block.id, segment.id, {
                                      startMinute: Number(event.target.value),
                                    })
                                  }
                                  className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-white outline-none focus:border-cyan-400"
                                >
                                  {startOptions.map((minute) => (
                                    <option key={minute} value={minute}>
                                      {formatMinuteOfDay(minute)}
                                    </option>
                                  ))}
                                </select>
                              </label>

                              <label className="block text-sm text-gray-300">
                                End
                                <select
                                  value={segment.endMinute}
                                  onChange={(event) =>
                                    updateSegment(block.id, segment.id, {
                                      endMinute: Number(event.target.value),
                                    })
                                  }
                                  className="mt-1 h-10 w-full rounded-md border border-gray-700 bg-gray-950 px-3 text-sm text-white outline-none focus:border-cyan-400"
                                >
                                  {endOptions.map((minute) => (
                                    <option key={minute} value={minute}>
                                      {formatMinuteOfDay(minute)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>

                            <textarea
                              value={segment.note}
                              onChange={(event) =>
                                updateSegment(block.id, segment.id, {
                                  note: event.target.value,
                                })
                              }
                              rows={3}
                              placeholder="Segment notes..."
                              className={`mt-3 min-h-20 w-full resize-y rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm leading-relaxed text-gray-100 outline-none placeholder:text-gray-600 focus:border-cyan-400 ${
                                segment.completed ? "line-through opacity-75" : ""
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
