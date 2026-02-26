"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div className="min-h-screen p-4 md:p-8 bg-gradient-to-b from-gray-950 via-gray-950 to-slate-950">
      <div className="max-w-5xl mx-auto min-h-[calc(100vh-2rem)] md:min-h-[calc(100vh-4rem)] grid md:grid-cols-2 gap-6 items-center">
        <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6 md:p-8 space-y-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">
            Welcome back
          </p>
          <h1 className="text-3xl md:text-4xl font-bold">
            Continue your research map
          </h1>
          <p className="text-gray-400 leading-relaxed">
            Reopen your maps, revisit topic evidence, and keep building your
            node and edge reasoning trails.
          </p>
          <ul className="space-y-2 text-sm text-gray-300">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              Pick up where you left off
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              Keep evidence and notes in context
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              Tune each map with its own layout settings
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6 md:p-8">
          <h2 className="text-2xl font-bold mb-1">Log In</h2>
          <p className="text-sm text-gray-400 mb-6">
            Sign in to access your maps.
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-950 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-gray-400">Password</label>
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-950 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-red-300 text-sm border border-red-500/40 bg-red-500/10 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg font-medium transition-colors"
            >
              {loading ? "Logging in..." : "Log in"}
            </button>
          </form>

          <p className="text-center text-gray-400 mt-5 text-sm">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-blue-300 hover:underline">
              Sign up
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
