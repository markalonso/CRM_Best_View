"use client";

import { MediaItem } from "./types";

export function MediaViewerModal({ items, index, onClose, onPrev, onNext }: { items: MediaItem[]; index: number; onClose: () => void; onPrev: () => void; onNext: () => void }) {
  const current = items[index];
  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-5" onClick={onClose}>
      <div className="max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between text-white">
          <button onClick={onPrev} className="rounded bg-white/20 px-3 py-1 text-sm">Prev</button>
          <span className="text-sm">{current.original_filename || current.media_type}</span>
          <button onClick={onNext} className="rounded bg-white/20 px-3 py-1 text-sm">Next</button>
        </div>

        {current.media_type === "image" && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.file_url} alt="media" className="max-h-[80vh] max-w-[90vw] rounded bg-white object-contain" />
          </>
        )}
        {current.media_type === "video" && <video src={current.file_url} controls className="max-h-[80vh] max-w-[90vw] rounded bg-black" />}
        {(current.media_type === "document" || current.media_type === "other") && (
          <div className="rounded bg-white p-6 text-center">
            <p className="mb-3 text-sm text-slate-700">Document preview</p>
            <a href={current.file_url} target="_blank" rel="noreferrer" className="rounded bg-slate-900 px-4 py-2 text-sm text-white">Open document</a>
          </div>
        )}
      </div>
    </div>
  );
}
