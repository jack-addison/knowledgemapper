import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

interface PaperContextSummary {
  id: string;
  file_name: string;
  paper_title: string;
  text_char_count: number | null;
  created_at: string;
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "42P01";
}

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mapId = normalizeString(request.nextUrl.searchParams.get("mapId"));
  if (!mapId) {
    return NextResponse.json({ error: "mapId is required." }, { status: 400 });
  }

  const { data: map, error: mapError } = await supabase
    .from("maps")
    .select("id")
    .eq("id", mapId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (mapError) {
    return NextResponse.json({ error: mapError.message }, { status: 500 });
  }
  if (!map) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("map_paper_contexts")
    .select("id, file_name, paper_title, text_char_count, created_at")
    .eq("user_id", user.id)
    .eq("map_id", mapId)
    .order("created_at", { ascending: false })
    .limit(60)
    .returns<PaperContextSummary[]>();

  if (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Paper context storage is not set up. Run supabase-paper-contexts.sql." },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    contexts: (data || []).map((item) => ({
      id: item.id,
      fileName: item.file_name,
      paperTitle: item.paper_title,
      textCharCount:
        typeof item.text_char_count === "number" ? item.text_char_count : null,
      createdAt: item.created_at,
    })),
  });
}
