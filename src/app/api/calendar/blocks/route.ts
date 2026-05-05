import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

interface SegmentPayload {
  startMinute?: unknown;
  endMinute?: unknown;
  note?: unknown;
  completed?: unknown;
}

function normalizeString(value: unknown, maxLength = 4000): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeMinute(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.trunc(parsed);
}

function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseBlockPayload(body: Record<string, unknown>) {
  const dateKey = body.dateKey;
  const startMinute = normalizeMinute(body.startMinute);
  const endMinute = normalizeMinute(body.endMinute);

  if (!isDateKey(dateKey) || startMinute === null || endMinute === null) {
    return null;
  }
  if (startMinute < 0 || startMinute >= 1440 || endMinute <= 0 || endMinute > 1440) {
    return null;
  }
  if (endMinute <= startMinute) return null;

  return {
    dateKey,
    startMinute,
    endMinute,
    title: normalizeString(body.title, 240),
    note: normalizeString(body.note),
    color: normalizeString(body.color, 32) || "#2563eb",
    completed: normalizeBoolean(body.completed),
  };
}

function parseSegmentPayload(segment: SegmentPayload, blockStart: number, blockEnd: number) {
  const startMinute = normalizeMinute(segment.startMinute);
  const endMinute = normalizeMinute(segment.endMinute);
  if (startMinute === null || endMinute === null) return null;
  if (startMinute < blockStart || endMinute > blockEnd || endMinute <= startMinute) {
    return null;
  }
  return {
    start_minute: startMinute,
    end_minute: endMinute,
    note: normalizeString(segment.note),
    completed: normalizeBoolean(segment.completed),
  };
}

async function requireUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseBlockPayload(body);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid block payload" }, { status: 400 });
  }

  const { data: block, error: blockError } = await supabase
    .from("calendar_blocks")
    .insert({
      user_id: user.id,
      date_key: parsed.dateKey,
      title: parsed.title,
      start_minute: parsed.startMinute,
      end_minute: parsed.endMinute,
      note: parsed.note,
      color: parsed.color,
      completed: parsed.completed,
    })
    .select("id, date_key, title, start_minute, end_minute, note, color, completed")
    .single();

  if (blockError) {
    return NextResponse.json({ error: blockError.message }, { status: 500 });
  }

  const rawSegments = Array.isArray(body.segments)
    ? (body.segments as SegmentPayload[])
    : [];
  const parsedSegments = rawSegments
    .map((segment) => parseSegmentPayload(segment, parsed.startMinute, parsed.endMinute))
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment));
  const segmentsToInsert =
    parsedSegments.length > 0
      ? parsedSegments
      : [
          {
            start_minute: parsed.startMinute,
            end_minute: parsed.endMinute,
            note: "",
            completed: false,
          },
        ];

  const { data: segments, error: segmentsError } = await supabase
    .from("calendar_segments")
    .insert(
      segmentsToInsert.map((segment) => ({
        ...segment,
        block_id: block.id,
        user_id: user.id,
      }))
    )
    .select("id, start_minute, end_minute, note, completed");

  if (segmentsError) {
    return NextResponse.json({ error: segmentsError.message }, { status: 500 });
  }

  return NextResponse.json({
    id: block.id,
    dateKey: block.date_key,
    title: block.title || "",
    startMinute: block.start_minute,
    endMinute: block.end_minute,
    note: block.note || "",
    color: block.color || "#2563eb",
    completed: Boolean(block.completed),
    segments: (segments || [])
      .sort((a, b) => a.start_minute - b.start_minute)
      .map((segment) => ({
        id: segment.id,
        startMinute: segment.start_minute,
        endMinute: segment.end_minute,
        note: segment.note || "",
        completed: Boolean(segment.completed),
      })),
  });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = normalizeString(body.id, 80).trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.title === "string") updates.title = normalizeString(body.title, 240);
  if (typeof body.note === "string") updates.note = normalizeString(body.note);
  if (typeof body.color === "string") updates.color = normalizeString(body.color, 32);
  if (typeof body.completed === "boolean") updates.completed = body.completed;

  const startMinute = normalizeMinute(body.startMinute);
  const endMinute = normalizeMinute(body.endMinute);
  if (startMinute !== null) updates.start_minute = startMinute;
  if (endMinute !== null) updates.end_minute = endMinute;

  const { data, error } = await supabase
    .from("calendar_blocks")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: data.id });
}

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = normalizeString(body.id, 80).trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("calendar_blocks")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id });
}
