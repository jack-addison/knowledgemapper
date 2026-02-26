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

  useEffect(() => {
    setNotes(initialNotes);
    setSaveState("idle");
  }, [initialNotes, topicName]);

  const wordCount = useMemo(() => {
    const trimmed = notes.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }, [notes]);

  const charCount = notes.length;

  const appendTemplate = useCallback((snippet: string) => {
    setNotes((prev) => {
      const trimmed = prev.trimEnd();
      const spacer = trimmed.length > 0 ? "\n\n" : "";
      return `${trimmed}${spacer}${snippet}`;
    });
    if (saveState !== "idle") setSaveState("idle");
  }, [saveState]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveState("idle");
    try {
      await onSave(notes);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  }, [notes, onSave]);

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
    <aside className="h-full border border-gray-700 rounded-lg bg-gray-900 p-4 flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Notes</h3>
          <p className="text-xs text-gray-400 mt-0.5">{topicName}</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-sm"
        >
          ✕
        </button>
      </div>

      <div className="mb-3 rounded-md border border-gray-800 bg-gray-800/40 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-gray-400">Quick note blocks</p>
          <span className="text-[11px] text-gray-500">Ctrl/Cmd+S to save</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
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
      </div>

      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          if (saveState !== "idle") setSaveState("idle");
        }}
        placeholder="Write notes about this topic..."
        className="flex-1 min-h-[260px] w-full px-3 py-2 text-sm bg-gray-950 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-gray-100 placeholder-gray-500 resize-none"
      />

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <span className="text-xs text-gray-500">
            {wordCount} words · {charCount} chars
          </span>
          <div>
            <span
              className={`text-xs ${
                saveState === "saved"
                  ? "text-green-400"
                  : saveState === "error"
                    ? "text-red-400"
                    : "text-gray-500"
              }`}
            >
              {saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Failed to save"
                  : " "}
            </span>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
        >
          {saving ? "Saving..." : "Save Notes"}
        </button>
      </div>
    </aside>
  );
}
