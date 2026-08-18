import { type DragEvent, useRef, useState } from "react";

/**
 * Drag-and-drop upload (spec section 4).
 *
 * Client-side extension filtering is a courtesy that saves a pointless round trip;
 * the server re-checks type, size and content regardless.
 */
export function FileDropzone({
  onFiles,
  disabled,
  accept = ".csv,.txt",
  busy,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  accept?: string;
  busy?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function accepted(list: FileList | null): File[] {
    if (!list) return [];
    const extensions = accept.split(",").map((e) => e.trim().toLowerCase());
    return Array.from(list).filter((file) =>
      extensions.some((extension) => file.name.toLowerCase().endsWith(extension)),
    );
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = accepted(event.dataTransfer.files);
    if (files.length) onFiles(files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`rounded-lg border-2 border-dashed p-8 text-center transition ${
        dragging ? "border-lab-500 bg-lab-50" : "border-lab-200 bg-white"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <p className="text-sm font-medium text-lab-900">
        {busy ? "Uploading…" : "Drop CSV files here"}
      </p>
      <p className="mt-1 text-sm text-slate-600">
        Multiple files are fine, and there is no limit on how many you upload. Nothing is
        ever overwritten.
      </p>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="mt-3 rounded bg-lab-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-lab-700 disabled:opacity-60"
      >
        Choose files
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        aria-label="Choose CSV files"
        className="hidden"
        onChange={(e) => {
          const files = accepted(e.target.files);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
