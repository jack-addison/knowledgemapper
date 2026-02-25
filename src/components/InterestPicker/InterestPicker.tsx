"use client";

import { useState, KeyboardEvent } from "react";

interface InterestPickerProps {
  interests: string[];
  onAdd: (interest: string) => void;
  onRemove: (interest: string) => void;
  loading?: boolean;
}

const SUGGESTIONS = [
  "Philosophy",
  "Machine Learning",
  "Astrophysics",
  "Psychology",
  "History",
  "Music Theory",
  "Economics",
  "Neuroscience",
  "Literature",
  "Mathematics",
  "Biology",
  "Art",
  "Programming",
  "Cooking",
  "Fitness",
  "Photography",
  "Architecture",
  "Film",
  "Linguistics",
  "Entrepreneurship",
];

export default function InterestPicker({
  interests,
  onAdd,
  onRemove,
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

  const filteredSuggestions = SUGGESTIONS.filter(
    (s) =>
      !interests.includes(s) &&
      s.toLowerCase().includes(input.toLowerCase()) &&
      input.length > 0
  );

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
        {filteredSuggestions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-gray-900 border border-gray-700 rounded-lg overflow-hidden">
            {filteredSuggestions.slice(0, 5).map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => {
                  onAdd(suggestion);
                  setInput("");
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-800 text-gray-300 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>

      {interests.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {interests.map((interest) => (
            <span
              key={interest}
              className="inline-flex items-center gap-1 px-3 py-1 bg-blue-600/20 border border-blue-500/30 text-blue-300 rounded-full text-sm"
            >
              {interest}
              <button
                onClick={() => onRemove(interest)}
                className="ml-1 hover:text-white transition-colors"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {interests.length === 0 && (
        <div>
          <p className="text-sm text-gray-500 mb-2">Quick add:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.slice(0, 10).map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => onAdd(suggestion)}
                className="px-3 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-full text-sm text-gray-400 transition-colors"
              >
                + {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
