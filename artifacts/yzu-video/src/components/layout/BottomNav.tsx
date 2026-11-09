import { Link, useLocation } from "wouter";
import { Home, Store, Wallet, Info, User } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";

/**
 * Mobile Bottom Navigation — 5 items matching Reference Image 2:
 * 1. Home – Home icon
 * 2. Shop – Store icon
 * 3. Top Up – Wallet icon
 * 4. Info – Information icon
 * 5. Profile – User icon
 *
 * Modern pill-shaped container, fixed at screen bottom with safe area padding,
 * soft purple accents and active item highlighted in violet gradient.
 */
export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  const navItems = [
    { href: "/", label: "Home", icon: Home, exact: true },
    { href: "/shop", label: "Shop", icon: Store, exact: false },
    { href: "/topup", label: "Top Up", icon: Wallet, exact: false },
    { href: "/info", label: "Info", icon: Info, exact: false },
    { href: user ? "/profile" : "/login", label: "Profile", icon: User, exact: false },
  ];

  const isItemActive = (item: typeof navItems[0]) => {
    if (item.exact) {
      return location === item.href;
    }
    return location.startsWith(item.href);
  };

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-50 pointer-events-none flex justify-center px-3"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 10px)" }}
    >
      <div className="w-full max-w-md pointer-events-auto">
        <nav
          className="relative flex items-center justify-between px-2 py-1.5 rounded-full bg-white/95 backdrop-blur-xl border border-purple-100 shadow-[0_8px_32px_rgba(124,58,237,0.15)]"
        >
          {navItems.map((item) => {
            const active = isItemActive(item);
            const Icon = item.icon;

            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex-1 flex flex-col items-center justify-center py-1 transition-all select-none"
              >
                <motion.div
                  whileTap={{ scale: 0.88 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="flex flex-col items-center gap-0.5"
                >
                  <div
                    className={`h-9 w-9 rounded-full flex items-center justify-center transition-all duration-300 ${
                      active
                        ? "bg-gradient-to-tr from-purple-600 to-violet-500 text-white shadow-md shadow-purple-500/30 scale-105"
                        : "text-slate-400 hover:text-purple-600 hover:bg-purple-50/60"
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" strokeWidth={active ? 2.5 : 2} />
                  </div>
                  <span
                    className={`text-[10px] font-extrabold tracking-tight transition-colors duration-200 ${
                      active ? "text-purple-600 font-black" : "text-slate-400"
                    }`}
                  >
                    {item.label}
                  </span>
                </motion.div>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
