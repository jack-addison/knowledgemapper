import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { computeTdaMapHealth } from "@/lib/tda";
import type { Interest } from "@/lib/types";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mapId = request.nextUrl.searchParams.get("mapId");
  if (!mapId) {
    return NextResponse.json({ error: "mapId is required" }, { status: 400 });
  }

  const { data: map, error: mapError } = await supabase
    .from("maps")
    .select("id")
    .eq("id", mapId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (mapError || !map) {
    return NextResponse.json({ error: "Invalid mapId" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("interests")
    .select("id, user_id, map_id, name, embedding, related_topics, notes, created_at")
    .eq("user_id", user.id)
    .eq("map_id", mapId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const parsed: Interest[] = (data || []).map((interest) => ({
    ...interest,
    embedding:
      typeof interest.embedding === "string"
        ? JSON.parse(interest.embedding)
        : interest.embedding,
  }));

  const health = computeTdaMapHealth(parsed);
  return NextResponse.json(health);
}
