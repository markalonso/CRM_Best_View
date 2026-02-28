"use client";

import { DragEvent, useEffect, useMemo, useState } from "react";
import { MediaSummary } from "./media-summary";
import { MediaItem } from "./types";
import { MediaViewerModal } from "./media-viewer-modal";

type Props = {
  intakeSessionId?: string;
  recordType?: "properties_sale" | "properties_rent" | "buyers" | "clients";
  recordId?: string;
  compact?: boolean;
};

export function MediaManager({ intakeSessionId, recordType, recordId, compact = false }: Props) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [warning, setWarning] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);

  function onDropFiles(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    onPick(Array.from(event.dataTransfer.files || []));
  }

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (intakeSessionId) p.set("intake_session_id", intakeSessionId);
    if (recordType) p.set("record_type", recordType);
    if (recordId) p.set("record_id", recordId);
    return p.toString();
  }, [intakeSessionId, recordType, recordId]);

  async function load() {
    const res = await fetch(`/api/media?${query}`, { cache: "no-store" });
    const data = await res.json();
    setItems(data.media || []);
  }

  useEffect(() => {
    load();
  }, [query]);

  function onPick(next: File[]) {
    setWarning("");
    if (intakeSessionId) {
      const existingSig = new Set(items.map((m) => `${m.original_filename}|${m.file_size ?? 0}`));
      const hasDup = next.some((f) => existingSig.has(`${f.name}|${f.size}`));
      if (hasDup) {
        setWarning("Some files appear to be duplicates in this intake session (same filename + size). They will be skipped.");
      }
    }
    setFiles([...next]);
  }

  async function upload() {
    if (files.length === 0) return;
    setUploading(true);
    const form = new FormData();
    if (intakeSessionId) form.set("intake_session_id", intakeSessionId);
    if (recordType) form.set("record_type", recordType);
    if (recordId) form.set("record_id", recordId);
    files.forEach((f) => form.append("files", f));

    const res = await fetch("/api/media", { method: "POST", body: form });
    if (res.ok) {
      setFiles([]);
      await load();
    }
    setUploading(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <MediaSummary items={items} />
        {!compact && (
          <label onDragOver={(e) => e.preventDefault()} onDrop={onDropFiles} className="cursor-pointer rounded border border-dashed border-slate-400 px-3 py-1 text-xs text-slate-700">
            Drag & drop or Upload
            <input type="file" multiple className="hidden" onChange={(e) => onPick(Array.from(e.target.files || []))} />
          </label>
        )}
      </div>

      {!compact && (
        <>
          {warning && <p className="text-xs text-orange-700">{warning}</p>}
          {files.length > 0 && (
            <div className="rounded bg-slate-50 p-2 text-xs text-slate-700">
              Selected: {files.length} file(s)
              <button className="ml-2 rounded bg-slate-900 px-2 py-1 text-white" onClick={upload} disabled={uploading}>
                {uploading ? "Uploading..." : "Upload now"}
              </button>
            </div>
          )}
        </>
      )}

      <div className="grid grid-cols-4 gap-2">
        {items.map((item, idx) => (
          <button key={item.id} className="overflow-hidden rounded border border-slate-200" onClick={() => setActiveIndex(idx)}>
            {item.media_type === "image" ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.file_url} alt={item.original_filename || "media"} className="h-16 w-full object-cover" />
              </>
            ) : (
              <div className="flex h-16 items-center justify-center bg-slate-100 text-xs">{item.media_type}</div>
            )}
          </button>
        ))}
        {items.length === 0 && <p className="col-span-4 text-xs text-slate-500">No media files.</p>}
      </div>

      {activeIndex !== null && (
        <MediaViewerModal
          items={items}
          index={activeIndex}
          onClose={() => setActiveIndex(null)}
          onPrev={() => setActiveIndex((p) => (p === null ? 0 : (p - 1 + items.length) % items.length))}
          onNext={() => setActiveIndex((p) => (p === null ? 0 : (p + 1) % items.length))}
        />
      )}
    </div>
  );
}
