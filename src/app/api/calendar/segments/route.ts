import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

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

async function requireUser() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}

async function fetchOwnedBlock(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  blockId: string
) {
  const { data, error } = await supabase
    .from("calendar_blocks")
    .select("id, start_minute, end_minute")
    .eq("id", blockId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const blockId = normalizeString(body.blockId, 80).trim();
  const startMinute = normalizeMinute(body.startMinute);
  const endMinute = normalizeMinute(body.endMinute);
  if (!blockId || startMinute === null || endMinute === null) {
    return NextResponse.json({ error: "Invalid segment payload" }, { status: 400 });
  }

  const block = await fetchOwnedBlock(supabase, user.id, blockId);
  if (!block) {
    return NextResponse.json({ error: "Invalid blockId" }, { status: 400 });
  }
  if (
    startMinute < block.start_minute ||
    endMinute > block.end_minute ||
    endMinute <= startMinute
  ) {
    return NextResponse.json(
      { error: "Segment must sit inside its block" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("calendar_segments")
    .insert({
      block_id: blockId,
      user_id: user.id,
      start_minute: startMinute,
      end_minute: endMinute,
      note: normalizeString(body.note),
      completed: normalizeBoolean(body.completed),
    })
    .select("id, start_minute, end_minute, note, completed")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    startMinute: data.start_minute,
    endMinute: data.end_minute,
    note: data.note || "",
    completed: Boolean(data.completed),
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
  if (typeof body.note === "string") updates.note = normalizeString(body.note);
  if (typeof body.completed === "boolean") updates.completed = body.completed;
  const startMinute = normalizeMinute(body.startMinute);
  const endMinute = normalizeMinute(body.endMinute);
  if (startMinute !== null) updates.start_minute = startMinute;
  if (endMinute !== null) updates.end_minute = endMinute;

  const { data, error } = await supabase
    .from("calendar_segments")
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
    .from("calendar_segments")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id });
}
