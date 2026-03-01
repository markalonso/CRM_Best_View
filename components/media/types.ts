export type MediaItem = {
  id: string;
  file_url: string;
  mime_type: string;
  media_type: "image" | "video" | "document" | "other";
  original_filename: string;
  file_size: number | null;
  created_at: string;
};
