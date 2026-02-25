import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { generateRecommendations } from "@/lib/openai";

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: interests } = await supabase
    .from("interests")
    .select("name")
    .eq("user_id", user.id);

  if (!interests || interests.length === 0) {
    return NextResponse.json(
      { error: "Add some interests first" },
      { status: 400 }
    );
  }

  const interestNames = interests.map((i) => i.name);

  try {
    const recommendations = await generateRecommendations(interestNames);
    return NextResponse.json(recommendations);
  } catch {
    return NextResponse.json(
      { error: "Failed to generate recommendations" },
      { status: 500 }
    );
  }
}
