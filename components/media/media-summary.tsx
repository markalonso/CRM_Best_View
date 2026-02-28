import { MediaItem } from "./types";

export function mediaCounts(items: MediaItem[]) {
  return {
    images: items.filter((m) => m.media_type === "image").length,
    videos: items.filter((m) => m.media_type === "video").length,
    docs: items.filter((m) => m.media_type === "document" || m.media_type === "other").length
  };
}

export function MediaSummary({ items }: { items: MediaItem[] }) {
  const counts = mediaCounts(items);
  return (
    <span>
      📷 {counts.images} | 🎥 {counts.videos} | 📄 {counts.docs}
    </span>
  );
}
