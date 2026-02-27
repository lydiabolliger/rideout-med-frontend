import { supabase } from "./supabase";

export async function fetchMyProfile() {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, full_name, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  return data; // kann null sein, wenn noch nicht vorhanden
}

export async function upsertMyProfile({ full_name, role }) {
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  if (!user) throw new Error("Not logged in");

  const payload = {
    user_id: user.id,
    full_name: full_name ?? null,
    role: role ?? "helper",
  };

  const { data, error } = await supabase
    .from("profiles")
    .upsert(payload, { onConflict: "user_id" })
    .select("user_id, full_name, role")
    .single();

  if (error) throw error;
  return data;
}
