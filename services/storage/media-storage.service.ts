import { createSupabaseClient } from "@/services/supabase/client";

export class MediaStorageService {
  private readonly bucket = "crm-media";

  async upload(path: string, file: File) {
    const supabase = createSupabaseClient();
    return supabase.storage.from(this.bucket).upload(path, file, { upsert: false });
  }

  getPublicUrl(path: string) {
    const supabase = createSupabaseClient();
    return supabase.storage.from(this.bucket).getPublicUrl(path).data.publicUrl;
  }
}
