import { createAdminSupabaseClient } from "@/lib/supabase-admin";

export type MapAccessRole = "owner" | "editor" | "viewer";

export interface MapAccess {
  mapId: string;
  ownerUserId: string;
  role: MapAccessRole;
  canEdit: boolean;
  canManage: boolean;
}

export interface AccessibleMapRecord {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  is_public: boolean | null;
  share_slug: string | null;
  shared_at: string | null;
  role: MapAccessRole;
  can_edit: boolean;
  can_manage: boolean;
}

function normalizeRole(value: unknown): MapAccessRole {
  if (value === "owner" || value === "editor" || value === "viewer") {
    return value;
  }
  return "viewer";
}

function roleFlags(role: MapAccessRole): { canEdit: boolean; canManage: boolean } {
  if (role === "owner") return { canEdit: true, canManage: true };
  if (role === "editor") return { canEdit: true, canManage: false };
  return { canEdit: false, canManage: false };
}

export async function getMapAccess(
  userId: string,
  mapId: string
): Promise<MapAccess | null> {
  const admin = createAdminSupabaseClient();
  const { data: map, error: mapError } = await admin
    .from("maps")
    .select("id, user_id")
    .eq("id", mapId)
    .maybeSingle();

  if (mapError || !map) return null;

  if (map.user_id === userId) {
    return {
      mapId: map.id,
      ownerUserId: map.user_id,
      role: "owner",
      canEdit: true,
      canManage: true,
    };
  }

  const { data: membership, error: membershipError } = await admin
    .from("map_collaborators")
    .select("role")
    .eq("map_id", mapId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipError) {
    if (membershipError.code === "42P01") return null;
    return null;
  }
  if (!membership) return null;

  const role = normalizeRole(membership.role);
  const flags = roleFlags(role);
  return {
    mapId: map.id,
    ownerUserId: map.user_id,
    role,
    canEdit: flags.canEdit,
    canManage: flags.canManage,
  };
}

export async function listAccessibleMaps(userId: string): Promise<AccessibleMapRecord[]> {
  const admin = createAdminSupabaseClient();
  const [ownedResult, membershipsResult] = await Promise.all([
    admin
      .from("maps")
      .select("id, user_id, name, created_at, is_public, share_slug, shared_at")
      .eq("user_id", userId),
    admin.from("map_collaborators").select("map_id, role").eq("user_id", userId),
  ]);

  if (ownedResult.error) {
    throw new Error(ownedResult.error.message);
  }

  const owned = (ownedResult.data || []).map((map) => ({
    ...map,
    role: "owner" as const,
    can_edit: true,
    can_manage: true,
  }));

  const memberships = membershipsResult.data || [];
  if (membershipsResult.error && membershipsResult.error.code !== "42P01") {
    throw new Error(membershipsResult.error.message);
  }
  const safeMemberships = membershipsResult.error?.code === "42P01" ? [] : memberships;
  const collaboratorMapIds = Array.from(
    new Set(
      safeMemberships
        .map((row) => row.map_id)
        .filter((mapId) => typeof mapId === "string" && mapId.length > 0)
    )
  ).filter((mapId) => !owned.some((map) => map.id === mapId));

  let collaboratorMaps: AccessibleMapRecord[] = [];
  if (collaboratorMapIds.length > 0) {
    const { data: maps, error } = await admin
      .from("maps")
      .select("id, user_id, name, created_at, is_public, share_slug, shared_at")
      .in("id", collaboratorMapIds);

    if (error) {
      throw new Error(error.message);
    }

    const roleByMap = new Map<string, MapAccessRole>();
    for (const member of safeMemberships) {
      const mapId = member.map_id;
      if (typeof mapId !== "string") continue;
      roleByMap.set(mapId, normalizeRole(member.role));
    }

    collaboratorMaps = (maps || []).map((map) => {
      const role = roleByMap.get(map.id) || "viewer";
      const flags = roleFlags(role);
      return {
        ...map,
        role,
        can_edit: flags.canEdit,
        can_manage: flags.canManage,
      };
    });
  }

  return [...owned, ...collaboratorMaps].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
}

export async function listAccessibleMapIds(userId: string): Promise<string[]> {
  const maps = await listAccessibleMaps(userId);
  return maps.map((map) => map.id);
}
