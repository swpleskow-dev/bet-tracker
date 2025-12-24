import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const { data, error } = await supabase.from("watchlist").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ watchlist: data ?? [] });
}

export async function POST(req: Request) {
  const body = await req.json();
  const game_id = String(body.game_id ?? "");
  const note = body.note ? String(body.note) : null;
  if (!game_id) return NextResponse.json({ error: "game_id required" }, { status: 400 });

  const { error } = await supabase.from("watchlist").insert({ game_id, note });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const game_id = searchParams.get("game_id");
  if (!game_id) return NextResponse.json({ error: "game_id required" }, { status: 400 });

  const { error } = await supabase.from("watchlist").delete().eq("game_id", game_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
