"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type JoinState = "idle" | "loading" | "success" | "auth_required" | "error";

export default function JoinMapPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = useMemo(
    () => (typeof params?.token === "string" ? params.token : ""),
    [params]
  );
  const [status, setStatus] = useState<JoinState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    async function join() {
      setStatus("loading");
      setMessage("");
      try {
        const res = await fetch("/api/maps/collaboration/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.status === 401) {
          setStatus("auth_required");
          setMessage("Log in first, then reopen this invite link.");
          return;
        }

        if (!res.ok) {
          setStatus("error");
          setMessage(
            typeof data.error === "string" ? data.error : "Failed to join map."
          );
          return;
        }

        setStatus("success");
        setMessage(
          typeof data.mapName === "string" && data.mapName
            ? `Joined "${data.mapName}".`
            : "Joined map successfully."
        );

        window.setTimeout(() => {
          router.push("/dashboard");
        }, 1200);
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Failed to join map.");
        }
      }
    }

    void join();
    return () => {
      cancelled = true;
    };
  }, [router, token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-gray-950 via-gray-950 to-slate-950">
      <div className="w-full max-w-lg rounded-2xl border border-gray-800 bg-gray-900/70 p-6 space-y-4">
        <h1 className="text-2xl font-semibold">Join collaborative map</h1>

        {status === "loading" && (
          <p className="text-sm text-gray-300">Joining map...</p>
        )}
        {!token && (
          <p className="text-sm text-red-300">Invalid invite link.</p>
        )}
        {status === "success" && (
          <p className="text-sm text-green-300">{message || "Joined map."}</p>
        )}
        {status === "auth_required" && (
          <div className="space-y-3">
            <p className="text-sm text-amber-300">{message}</p>
            <div className="flex items-center gap-2">
              <Link
                href={`/login?next=${encodeURIComponent(`/join/${token}`)}`}
                className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-sm"
              >
                Log in
              </Link>
              <Link
                href={`/signup?next=${encodeURIComponent(`/join/${token}`)}`}
                className="px-3 py-1.5 rounded-md border border-gray-700 hover:border-gray-500 text-sm"
              >
                Sign up
              </Link>
            </div>
          </div>
        )}
        {status === "error" && (
          <p className="text-sm text-red-300">{message || "Unable to join map."}</p>
        )}

        <Link
          href="/dashboard"
          className="inline-block text-xs text-gray-400 hover:text-gray-200"
        >
          Return to dashboard
        </Link>
      </div>
    </div>
  );
}
