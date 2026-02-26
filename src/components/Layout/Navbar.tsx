"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  const links = [
    { href: "/dashboard", label: "Map" },
    { href: "/discover", label: "Discover" },
    { href: "/profile", label: "Profile" },
    { href: "/about", label: "About" },
  ];

  return (
    <nav className="border-b border-gray-800 px-4 sm:px-6 py-4">
      <div className="w-full flex items-center justify-between">
        <Link
          href="/dashboard"
          className="text-xl font-bold text-blue-400"
        >
          KnowledgeMapper
        </Link>
        <div className="flex items-center gap-6">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm transition-colors ${
                pathname === link.href
                  ? "text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}
