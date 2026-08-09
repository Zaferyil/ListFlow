"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const ACCEPTED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];
const ACCEPT_ATTRIBUTE = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg";
const MAX_BYTES = 8 * 1024 * 1024;

function isAccepted(file: File): boolean {
  // Some systems report an SVG as text/xml or send no type at all, so fall back
  // to the extension rather than rejecting a file the server would have taken.
  if (file.type.startsWith("image/")) return true;
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

function formatSize(bytes: number): string {
  // Small vector files round to "0 KB" if you jump straight to kilobytes.
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DropZone({
  file,
  onFileChange,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // dragenter/dragleave also fire when the pointer crosses a child element, so
  // a boolean flickers. Counting enters and leaves is the reliable form.
  const dragDepth = useRef(0);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Without this, a file dropped just outside the zone makes the browser
  // navigate away from the app and lose whatever the user had typed.
  useEffect(() => {
    const swallow = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  const accept = useCallback(
    (candidate: File | undefined) => {
      if (!candidate) return;

      if (!isAccepted(candidate)) {
        setRejection(`${candidate.name} is not an image. Use PNG, JPEG, WebP, GIF or SVG.`);
        return;
      }
      if (candidate.size > MAX_BYTES) {
        setRejection(`${candidate.name} is ${formatSize(candidate.size)} — the limit is 8 MB.`);
        return;
      }

      setRejection(null);
      onFileChange(candidate);
    },
    [onFileChange],
  );

  return (
    <div className="field">
      <label htmlFor="design">Design file</label>

      <div
        className={`dropzone${dragging ? " dragging" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Choose a design file, or drop one here"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
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
          accept(event.dataTransfer.files[0]);
        }}
      >
        <input
          ref={inputRef}
          id="design"
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="visually-hidden"
          onChange={(event) => accept(event.target.files?.[0])}
        />

        {previewUrl && file ? (
          <div className="dropzone-filled">
            {/* Checkerboard behind the preview so a white design on a transparent
                canvas is still visible, and transparency is obvious at a glance. */}
            <span className="preview-frame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Preview of the uploaded design" />
            </span>
            <div className="dropzone-meta">
              <strong>{file.name}</strong>
              <span>{formatSize(file.size)}</span>
              <button
                type="button"
                className="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  setRejection(null);
                  onFileChange(null);
                  if (inputRef.current) inputRef.current.value = "";
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="dropzone-empty">
            <strong>Drop your design here</strong>
            <span>or click to browse — PNG, JPEG, WebP, GIF, SVG, max 8 MB</span>
          </div>
        )}
      </div>

      {rejection && <p className="hint rejection">{rejection}</p>}
    </div>
  );
}
