"use client";

import { useEffect, useState } from "react";

interface NotesSidebarProps {
  topicName: string;
  initialNotes: string;
  onSave: (notes: string) => Promise<void>;
  onClose: () => void;
}

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

  async function handleSave() {
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
  }

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
