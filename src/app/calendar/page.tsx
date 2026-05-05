"use client";

import { useMemo, useState } from "react";
import Navbar from "@/components/Layout/Navbar";

type SegmentSize = 5 | 10 | 15 | 20 | 30 | 60;

interface SelectedHour {
  dateKey: string;
  dayLabel: string;
  hour: number;
}

type CalendarNotes = Record<string, string>;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const SEGMENT_SIZES: SegmentSize[] = [60, 30, 20, 15, 10, 5];
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

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function formatSegmentTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function slotKey(dateKey: string, hour: number, minute: number): string {
  return `${dateKey}:${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function countHourNotes(notes: CalendarNotes, dateKey: string, hour: number): number {
  const prefix = `${dateKey}:${String(hour).padStart(2, "0")}:`;
  return Object.entries(notes).filter(
    ([key, value]) => key.startsWith(prefix) && value.trim().length > 0
  ).length;
}

function firstHourNote(notes: CalendarNotes, dateKey: string, hour: number): string {
  const prefix = `${dateKey}:${String(hour).padStart(2, "0")}:`;
  const item = Object.entries(notes).find(
    ([key, value]) => key.startsWith(prefix) && value.trim().length > 0
  );
  return item?.[1].trim() || "";
}

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [notes, setNotes] = useState<CalendarNotes>({});
  const [segmentSizeByHour, setSegmentSizeByHour] = useState<Record<string, SegmentSize>>(
    {}
  );
  const [selectedHour, setSelectedHour] = useState<SelectedHour | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

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

  const selectedHourKey = selectedHour
    ? `${selectedHour.dateKey}:${String(selectedHour.hour).padStart(2, "0")}`
    : "";
  const activeSegmentSize = selectedHour
    ? segmentSizeByHour[selectedHourKey] || 60
    : 60;
  const activeSegments = useMemo(() => {
    if (!selectedHour) return [];
    return Array.from({ length: 60 / activeSegmentSize }, (_, index) => ({
      minute: index * activeSegmentSize,
      key: slotKey(selectedHour.dateKey, selectedHour.hour, index * activeSegmentSize),
    }));
  }, [activeSegmentSize, selectedHour]);

  function moveWeek(offset: number) {
    setWeekStart((current) => addDays(current, offset * 7));
    setSelectedHour(null);
  }

  function updateNote(key: string, value: string) {
    setNotes((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateSegmentSize(size: SegmentSize) {
    if (!selectedHour) return;
    setSegmentSizeByHour((current) => ({
      ...current,
      [selectedHourKey]: size,
    }));
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
              <p className="text-sm text-gray-400">{weekLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => moveWeek(-1)}
                className="h-9 px-3 rounded-md border border-gray-700 bg-gray-900 text-sm text-gray-200 hover:border-gray-500"
                aria-label="Previous week"
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
                aria-label="Next week"
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
          <div className="min-w-[980px]">
            <div className="sticky top-0 z-20 grid grid-cols-[72px_repeat(7,minmax(128px,1fr))] border-b border-gray-800 bg-gray-950">
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

            <div className="grid grid-cols-[72px_repeat(7,minmax(128px,1fr))]">
              {HOURS.map((hour) => (
                <div key={hour} className="contents">
                  <div className="min-h-16 border-r border-b border-gray-800 bg-gray-950 px-3 py-2 text-xs text-gray-500">
                    {formatHour(hour)}
                  </div>
                  {days.map((day) => {
                    const noteCount = countHourNotes(notes, day.key, hour);
                    const preview = firstHourNote(notes, day.key, hour);
                    const isSelected =
                      selectedHour?.dateKey === day.key && selectedHour.hour === hour;

                    return (
                      <button
                        type="button"
                        key={`${day.key}-${hour}`}
                        onClick={() =>
                          setSelectedHour({
                            dateKey: day.key,
                            dayLabel: day.label,
                            hour,
                          })
                        }
                        className={`min-h-16 border-r border-b border-gray-800 px-2 py-2 text-left align-top transition-colors hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-inset ${
                          isSelected ? "bg-cyan-950/40" : day.isToday ? "bg-cyan-950/10" : "bg-gray-950"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-gray-500">{formatHour(hour)}</span>
                          {noteCount > 0 ? (
                            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[11px] text-cyan-200">
                              {noteCount}
                            </span>
                          ) : null}
                        </div>
                        {preview ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-snug text-gray-300">
                            {preview}
                          </p>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))}
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
                aria-label="Close hour editor"
              >
                x
              </button>
            </div>
          </div>

          <div className="border-b border-gray-800 px-5 py-4">
            <label className="text-sm font-medium text-gray-200" htmlFor="segment-size">
              Segment length
            </label>
            <select
              id="segment-size"
              value={activeSegmentSize}
              onChange={(event) => updateSegmentSize(Number(event.target.value) as SegmentSize)}
              className="mt-2 h-10 w-full rounded-md border border-gray-700 bg-gray-900 px-3 text-sm text-white outline-none focus:border-cyan-400"
            >
              {SEGMENT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} minutes
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="space-y-3">
              {activeSegments.map((segment) => (
                <div key={segment.key} className="grid gap-2 md:grid-cols-[76px_1fr]">
                  <label
                    htmlFor={segment.key}
                    className="pt-2 text-sm font-medium text-gray-300"
                  >
                    {formatSegmentTime(selectedHour.hour, segment.minute)}
                  </label>
                  <textarea
                    id={segment.key}
                    value={notes[segment.key] || ""}
                    onChange={(event) => updateNote(segment.key, event.target.value)}
                    rows={activeSegmentSize >= 30 ? 5 : 3}
                    placeholder="Add notes..."
                    className="min-h-20 resize-y rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm leading-relaxed text-gray-100 outline-none placeholder:text-gray-600 focus:border-cyan-400"
                  />
                </div>
              ))}
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
