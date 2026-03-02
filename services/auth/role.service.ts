import { NextRequest } from "next/server";
import { createSupabaseClient } from "@/services/supabase/client";

export type AppRole = "admin" | "agent" | "viewer";

export type RequestActor = {
  userId: string | null;
  role: AppRole;
  name: string;
};

const roleRank: Record<AppRole, number> = { viewer: 1, agent: 2, admin: 3 };

function parseBearer(request: NextRequest) {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

export async function getRequestActor(request: NextRequest): Promise<RequestActor> {
  const supabase = createSupabaseClient();
  const bearer = parseBearer(request);

  const { data: authData } = bearer ? await supabase.auth.getUser(bearer) : await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return { userId: null, role: "viewer", name: "Anonymous" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role,name")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = (profile?.role || "viewer") as AppRole;
  return {
    userId: user.id,
    role: role === "admin" || role === "agent" || role === "viewer" ? role : "viewer",
    name: String(profile?.name || user.email || "User")
  };
}

export function hasRole(actorRole: AppRole, minimum: AppRole) {
  return roleRank[actorRole] >= roleRank[minimum];
}
