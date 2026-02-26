"use client";

import { useState, KeyboardEvent } from "react";

interface InterestPickerProps {
  interests: string[];
  onAdd: (interest: string) => void;
  loading?: boolean;
}

export default function InterestPicker({
  interests,
  onAdd,
  loading,
}: InterestPickerProps) {
  const [input, setInput] = useState("");

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      const value = input.trim();
      if (!interests.includes(value)) {
        onAdd(value);
      }
      setInput("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type an interest and press Enter..."
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500 text-white placeholder-gray-500"
          disabled={loading}
        />
      </div>
    </div>
  );
}
