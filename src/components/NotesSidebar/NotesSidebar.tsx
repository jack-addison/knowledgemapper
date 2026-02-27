"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface NotesSidebarProps {
  topicName: string;
  initialNotes: string;
  onSave: (notes: string) => Promise<void>;
  onClose: () => void;
}

const NOTE_TEMPLATES = [
  {
    id: "claim",
    label: "Claim",
    text: "Claim:\n- ",
  },
  {
    id: "evidence",
    label: "Evidence",
    text: "Evidence:\n- Source:\n- Key result:\n- Confidence:\n",
  },
  {
    id: "question",
    label: "Open Question",
    text: "Open question:\n- ",
  },
  {
    id: "next-step",
    label: "Next Step",
    text: "Next step:\n- ",
  },
  {
    id: "citation",
    label: "Citation",
    text: "Citation note:\n- Author (Year):\n- Why relevant:\n",
  },
];

export default function NotesSidebar({
  topicName,
  initialNotes,
  onSave,
  onClose,
}: NotesSidebarProps) {
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">(
    "idle"
  );
  const [autoSave, setAutoSave] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  const [quickBlocksOpen, setQuickBlocksOpen] = useState(false);

  useEffect(() => {
    setNotes(initialNotes);
    setSaveState("idle");
    setDirty(false);
    setLastSavedAt(null);
    setCopyState("idle");
    setQuickBlocksOpen(false);
  }, [initialNotes, topicName]);

  const wordCount = useMemo(() => {
    const trimmed = notes.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }, [notes]);

  const charCount = notes.length;

  const markDirty = useCallback(() => {
    setDirty(true);
    if (saveState !== "idle") setSaveState("idle");
  }, [saveState]);

  const appendTemplate = useCallback(
    (snippet: string) => {
      setNotes((prev) => {
        const trimmed = prev.trimEnd();
        const spacer = trimmed.length > 0 ? "\n\n" : "";
        return `${trimmed}${spacer}${snippet}`;
      });
      markDirty();
    },
    [markDirty]
  );

  const insertTimestamp = useCallback(() => {
    const stamp = new Date().toLocaleString();
    appendTemplate(`Timestamp:\n- ${stamp}\n- `);
  }, [appendTemplate]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveState("idle");
    try {
      await onSave(notes);
      setSaveState("saved");
      setDirty(false);
      setLastSavedAt(new Date().toISOString());
    } catch {
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }, [notes, onSave]);

  const handleRevert = useCallback(() => {
    setNotes(initialNotes);
    setDirty(false);
    setSaveState("idle");
  }, [initialNotes]);

  const handleCopy = useCallback(async () => {
    if (!notes.trim()) return;
    try {
      await navigator.clipboard.writeText(notes);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }, [notes]);

  useEffect(() => {
    if (!autoSave || !dirty || saving) return;
    const timeout = window.setTimeout(() => {
      void handleSave();
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [autoSave, dirty, handleSave, saving]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 1800);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "s") {
        event.preventDefault();
        if (!saving) {
          void handleSave();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, saving]);

  return (
    <aside className="h-full border border-gray-700 rounded-lg bg-gray-900 p-3 md:p-4 flex flex-col">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">Notes</h3>
          <p className="mt-0.5 text-[11px] text-gray-400">{topicName}</p>
        </div>
        <button
          onClick={onClose}
          className="text-sm text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <label className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-2.5 py-1 text-[11px] text-gray-300">
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(e) => setAutoSave(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-900 accent-blue-500"
          />
          Autosave
        </label>
        <button
          type="button"
          onClick={insertTimestamp}
          className="rounded-md border border-gray-700 px-2.5 py-1 text-[11px] text-gray-300 hover:border-blue-500/60 hover:text-blue-200"
        >
          Insert timestamp
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          disabled={!notes.trim()}
          className="rounded-md border border-gray-700 px-2.5 py-1 text-[11px] text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50"
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "error"
              ? "Copy failed"
              : "Copy notes"}
        </button>
      </div>

      <div className="mb-2 rounded-md border border-gray-800 bg-gray-800/40 p-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-gray-400">Quick note blocks</p>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500">
              {autoSave ? "Autosave on" : "Ctrl/Cmd+S to save"}
            </span>
            <button
              type="button"
              onClick={() => setQuickBlocksOpen((prev) => !prev)}
              className="rounded border border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-300 hover:border-gray-500 hover:text-white"
            >
              {quickBlocksOpen ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        {quickBlocksOpen && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {NOTE_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => appendTemplate(template.text)}
                className="rounded-full border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:border-blue-500/60 hover:text-blue-200"
              >
                {template.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          markDirty();
        }}
        placeholder="Write notes about this topic..."
        className="flex-1 min-h-[420px] w-full px-3 py-2 text-sm bg-gray-950 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-gray-100 placeholder-gray-500 resize-none"
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="space-y-0.5">
          <span className="text-[11px] text-gray-500">
            {wordCount} words · {charCount} chars
          </span>
          <div>
            <span
              className={`text-[11px] ${
                saveState === "error"
                  ? "text-red-400"
                  : saving
                    ? "text-blue-300"
                    : dirty
                      ? "text-amber-300"
                      : saveState === "saved"
                        ? "text-green-400"
                        : "text-gray-500"
              }`}
            >
              {saveState === "error"
                ? "Failed to save"
                : saving
                  ? "Saving..."
                  : dirty
                    ? autoSave
                      ? "Unsaved changes (autosave pending)"
                      : "Unsaved changes"
                    : lastSavedAt
                      ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
                      : saveState === "saved"
                        ? "Saved"
                        : " "}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRevert}
            disabled={!dirty || saving}
            className="rounded-md border border-gray-700 px-2.5 py-1 text-[11px] text-gray-200 transition-colors hover:border-gray-500 disabled:opacity-50"
          >
            Revert
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (!dirty && saveState === "saved")}
            className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Notes"}
          </button>
        </div>
      </div>
    </aside>
  );
}
