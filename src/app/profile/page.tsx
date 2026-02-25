"use client";

import { useState, useEffect } from "react";
import Navbar from "@/components/Layout/Navbar";
import { createClient } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export default function ProfilePage() {
  const [user, setUser] = useState<User | null>(null);
  const [interestCount, setInterestCount] = useState(0);
  const supabase = createClient();

  useEffect(() => {
    async function loadProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        const res = await fetch("/api/interests");
        if (res.ok) {
          const data = await res.json();
          setInterestCount(data.length);
        }
      }
    }
    loadProfile();
  }, [supabase.auth]);

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="max-w-2xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-6">Profile</h2>

        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4">
          <div>
            <label className="text-sm text-gray-400">Email</label>
            <p className="text-white">{user?.email || "Loading..."}</p>
          </div>
          <div>
            <label className="text-sm text-gray-400">Member since</label>
            <p className="text-white">
              {user?.created_at
                ? new Date(user.created_at).toLocaleDateString()
                : "Loading..."}
            </p>
          </div>
          <div>
            <label className="text-sm text-gray-400">Interests mapped</label>
            <p className="text-white">{interestCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
