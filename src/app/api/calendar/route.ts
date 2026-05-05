import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

interface CalendarBlockRow {
  id: string;
  date_key: string;
  title: string | null;
  start_minute: number;
  end_minute: number;
  note: string | null;
  color: string | null;
  completed: boolean | null;
}

interface CalendarSegmentRow {
  id: string;
  block_id: string;
  start_minute: number;
  end_minute: number;
  note: string | null;
  completed: boolean | null;
}

function isDateKey(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const weekStart = request.nextUrl.searchParams.get("weekStart");
  if (!isDateKey(weekStart)) {
    return NextResponse.json(
      { error: "weekStart must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const weekEnd = addDaysToDateKey(weekStart, 6);
  const { data: blocks, error: blocksError } = await supabase
    .from("calendar_blocks")
    .select("id, date_key, title, start_minute, end_minute, note, color, completed")
    .eq("user_id", user.id)
    .gte("date_key", weekStart)
    .lte("date_key", weekEnd)
    .order("date_key", { ascending: true })
    .order("start_minute", { ascending: true })
    .returns<CalendarBlockRow[]>();

  if (blocksError) {
    return NextResponse.json({ error: blocksError.message }, { status: 500 });
  }

  const blockIds = (blocks || []).map((block) => block.id);
  let segments: CalendarSegmentRow[] = [];
  if (blockIds.length > 0) {
    const { data, error } = await supabase
      .from("calendar_segments")
      .select("id, block_id, start_minute, end_minute, note, completed")
      .eq("user_id", user.id)
      .in("block_id", blockIds)
      .order("start_minute", { ascending: true })
      .returns<CalendarSegmentRow[]>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    segments = data || [];
  }

  const segmentsByBlock = new Map<string, CalendarSegmentRow[]>();
  for (const segment of segments) {
    const existing = segmentsByBlock.get(segment.block_id) || [];
    existing.push(segment);
    segmentsByBlock.set(segment.block_id, existing);
  }

  return NextResponse.json({
    blocks: (blocks || []).map((block) => ({
      id: block.id,
      dateKey: block.date_key,
      title: block.title || "",
      startMinute: block.start_minute,
      endMinute: block.end_minute,
      note: block.note || "",
      color: block.color || "#2563eb",
      completed: Boolean(block.completed),
      segments: (segmentsByBlock.get(block.id) || []).map((segment) => ({
        id: segment.id,
        startMinute: segment.start_minute,
        endMinute: segment.end_minute,
        note: segment.note || "",
        completed: Boolean(segment.completed),
      })),
    })),
  });
}
