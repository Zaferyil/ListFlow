"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A drop area for several files at once — the template photos.
 *
 * DropZone next door handles the single design file and keeps a preview of it;
 * here the caller owns the list, so this only collects files and hands them
 * over.
 */
export function FileDrop({
  id,
  accept,
  label,
  hint,
  disabled,
  onFiles,
}: {
  id: string;
  accept: string;
  label: string;
  hint: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // dragenter/dragleave fire again for every child element, so a boolean
  // flickers; counting enters against leaves is the reliable form.
  const dragDepth = useRef(0);

  // Without this a file dropped just outside the area makes the browser open
  // it and abandon the page, losing whatever was typed.
  useEffect(() => {
    const swallow = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  function open() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div
      className={`dropzone${dragging ? " dragging" : ""}${disabled ? " disabled" : ""}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={label}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (disabled) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (disabled) return;

        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) onFiles(files);
      }}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        multiple
        className="visually-hidden"
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length > 0) onFiles(files);
          event.target.value = "";
        }}
      />

      <div className="dropzone-empty">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
    </div>
  );
}
