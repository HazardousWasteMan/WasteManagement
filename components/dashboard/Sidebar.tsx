"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "My projects" },
  { href: "/order", label: "Order analysis" },
  { href: "/shipments", label: "Shipments" },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 bg-forest text-cream min-h-screen px-4 py-6 flex flex-col gap-8">
      <div>
        <p className="text-lime font-semibold text-lg leading-tight">Waste Screening</p>
        <p className="text-cream/50 text-xs uppercase tracking-wide mt-1">Portal</p>
      </div>
      <nav className="flex flex-col gap-1">
        {LINKS.map(({ href, label }) => {
          const active =
            href === "/"
              ? pathname === "/" || pathname.startsWith("/projects") || pathname.startsWith("/cases")
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`rounded-xl px-3 py-2 text-sm transition-colors ${
                active ? "bg-forest-light text-lime font-medium" : "text-cream/70 hover:bg-forest-light/60 hover:text-cream"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
