"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const passwordChecks = useMemo(
    () => [
      { label: "At least 6 characters", ok: password.length >= 6 },
      { label: "Contains a letter", ok: /[a-zA-Z]/.test(password) },
      { label: "Contains a number", ok: /\d/.test(password) },
    ],
    [password]
  );

  const passwordScore = passwordChecks.filter((check) => check.ok).length;

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) {
      setError(error.message);
    } else if (data.session) {
      router.push("/dashboard");
      return;
    } else {
      setSuccess(
        "Account created. Check your email to confirm your account, then log in."
      );
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen p-4 md:p-8 bg-gradient-to-b from-gray-950 via-gray-950 to-slate-950">
      <div className="max-w-5xl mx-auto min-h-[calc(100vh-2rem)] md:min-h-[calc(100vh-4rem)] grid md:grid-cols-2 gap-6 items-center">
        <section className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6 md:p-8 space-y-4">
          <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">KnowledgeMapper</p>
          <h1 className="text-3xl md:text-4xl font-bold">
            Build your research map
          </h1>
          <p className="text-gray-400 leading-relaxed">
            Create structured maps of topics, track evidence at node and edge
            level, and keep notes tied directly to your graph.
          </p>
          <ul className="space-y-2 text-sm text-gray-300">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              Multiple named maps per account
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              Topic and connection evidence trails
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              Persistent notes and graph analytics
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-800 bg-gray-900 p-6 md:p-8">
          <h2 className="text-2xl font-bold mb-1">Create Account</h2>
          <p className="text-sm text-gray-400 mb-6">
            Start with your email and password.
          </p>

          <form onSubmit={handleSignup} className="space-y-4">
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
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-gray-400">
                  Confirm password
                </label>
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  className="text-xs text-gray-500 hover:text-gray-300"
                >
                  {showConfirmPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-950 border border-gray-700 rounded-lg focus:outline-none focus:border-blue-500"
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-3 space-y-1.5">
              <p className="text-xs text-gray-400">
                Password strength: {passwordScore}/3
              </p>
              {passwordChecks.map((check) => (
                <p
                  key={check.label}
                  className={`text-xs ${
                    check.ok ? "text-green-300" : "text-gray-500"
                  }`}
                >
                  {check.ok ? "✓" : "•"} {check.label}
                </p>
              ))}
            </div>

            {error && (
              <p className="text-red-300 text-sm border border-red-500/40 bg-red-500/10 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            {success && (
              <p className="text-green-300 text-sm border border-green-500/40 bg-green-500/10 rounded-md px-3 py-2">
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg font-medium transition-colors"
            >
              {loading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="text-center text-gray-400 mt-5 text-sm">
            Already have an account?{" "}
            <Link href="/login" className="text-blue-300 hover:underline">
              Log in
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
