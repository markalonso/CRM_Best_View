import { createSupabaseClient } from "@/services/supabase/client";
import { MediaStorageProvider, StorageUploadResult } from "./storage-provider";

export class SupabaseMediaProvider implements MediaStorageProvider {
  constructor(private readonly bucket = "crm-media") {}

  async upload(path: string, file: File): Promise<StorageUploadResult> {
    const supabase = createSupabaseClient();
    const { error } = await supabase.storage.from(this.bucket).upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false
    });

    if (error) throw new Error(error.message);
    return { path, publicUrl: this.getPublicUrl(path) };
  }

  getPublicUrl(path: string) {
    const supabase = createSupabaseClient();
    return supabase.storage.from(this.bucket).getPublicUrl(path).data.publicUrl;
  }
}
