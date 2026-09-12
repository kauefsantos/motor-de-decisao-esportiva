export async function adminDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type AdminDb = Awaited<ReturnType<typeof adminDb>>;
