import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { Home, Gift, Crown, Wallet, User, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  // Unread chat badge
  const { data: chatUnread } = useQuery({
    queryKey: ["chat-nav-unread"],
    queryFn: async () => {
      const [chat, ann] = await Promise.all([
        adminFetch<{ unread: number }>("/chat/unread").catch(() => ({ unread: 0 })),
        adminFetch<{ unread: number }>("/announcements-unread").catch(() => ({ unread: 0 })),
      ]);
      return Math.min((chat.unread ?? 0) + (ann.unread ?? 0), 99);
    },
    refetchInterval: 15000,
    enabled: !!user,
  });

  const navItems = [
    { href: "/", icon: Home, label: "Home" },
    { href: "/chat", icon: MessageCircle, label: "Chat", badge: chatUnread ?? 0 },
    { href: "/bundles", icon: Gift, label: "Bundles" },
    { href: "/subscriptions", icon: Crown, label: "Premium" },
    { href: user ? "/profile" : "/login", icon: User, label: "Profil" },
  ];

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location.startsWith(href);
  };

  return (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-slate-100 shadow-[0_-8px_32px_rgba(124,58,237,0.08)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <nav className="flex justify-around items-center h-[64px] px-1">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const badge = (item as any).badge ?? 0;

          return (
            <Link
              key={item.label}
              href={item.href}
              className="flex flex-col items-center justify-center w-full h-full gap-0.5 relative"
            >
              {/* Active indicator pill */}
              {active && (
                <motion.div
                  layoutId="nav-active"
                  className="absolute top-1 h-1 w-6 rounded-full bg-gradient-to-r from-purple-500 to-pink-500"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}

              <div className="relative mt-1">
                {/* Icon container */}
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center transition-all duration-300 ${
                  active
                    ? "bg-gradient-to-br from-purple-500 to-pink-500 shadow-md shadow-purple-500/30 scale-105"
                    : ""
                }`}>
                  <item.icon
                    className={`h-5 w-5 transition-all duration-300 ${
                      active ? "text-white" : "text-slate-400"
                    }`}
                    strokeWidth={active ? 2.5 : 2}
                  />
                </div>

                {/* Badge */}
                {badge > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1 shadow-sm"
                  >
                    {badge > 99 ? "99+" : badge}
                  </motion.span>
                )}
              </div>

              <span className={`text-[10px] font-extrabold transition-all duration-300 ${
                active ? "text-purple-600" : "text-slate-400"
              }`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
