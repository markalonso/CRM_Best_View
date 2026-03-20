"use client";

type Props = {
  open: boolean;
  title: string;
  description: string;
  impacts?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  confirming?: boolean;
  tone?: "danger" | "default";
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmationModal({
  open,
  title,
  description,
  impacts = [],
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirming = false,
  tone = "danger",
  onConfirm,
  onClose
}: Props) {
  if (!open) return null;

  const confirmClass = tone === "danger"
    ? "bg-rose-600 text-white hover:bg-rose-700"
    : "bg-slate-900 text-white hover:bg-slate-800";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="mt-2 text-sm text-slate-600">{description}</p>
        </div>

        {impacts.length > 0 && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Impact</p>
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {impacts.map((impact) => (
                <li key={impact} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>{impact}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            {cancelLabel}
          </button>
          <button type="button" disabled={confirming} onClick={onConfirm} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${confirmClass}`}>
            {confirming ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
