import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { Home, Gift, CreditCard, MessageCircle, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  // Combined unread: group chat + DM + announcements
  const { data: chatUnread } = useQuery({
    queryKey: ["chat-nav-unread"],
    queryFn: async () => {
      const [groupChat, ann, dm] = await Promise.all([
        adminFetch<{ unread: number }>("/chat/unread").catch(() => ({ unread: 0 })),
        adminFetch<{ unread: number }>("/announcements-unread").catch(() => ({ unread: 0 })),
        adminFetch<{ unread: number }>("/dm/unread").catch(() => ({ unread: 0 })),
      ]);
      return Math.min(
        (groupChat.unread ?? 0) + (ann.unread ?? 0) + (dm.unread ?? 0),
        99
      );
    },
    refetchInterval: 15000,
    enabled: !!user,
  });

  // Notifications unread
  const { data: notifUnread } = useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => adminFetch<{ unread: number }>("/notifications/unread-count"),
    refetchInterval: 30000,
    enabled: !!user,
  });

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location.startsWith(href);
  };

  const regularItems = [
    { href: "/",        icon: Home,          label: "Home",    badge: 0 },
    { href: "/bundles", icon: Gift,          label: "Bundles", badge: 0 },
  ];

  const rightItems = [
    { href: "/chat",               icon: MessageCircle, label: "Chat",    badge: chatUnread ?? 0 },
    { href: user ? "/profile" : "/login", icon: User, label: "Profile", badge: notifUnread?.unread ?? 0 },
  ];

  const topupActive = isActive("/topup");

  return (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-3 mb-3">
        {/* Glassmorphism floating nav bar */}
        <nav
          className="relative flex items-end justify-around rounded-[28px] bg-white/90 backdrop-blur-xl border border-white/50 shadow-[0_8px_40px_rgba(124,58,237,0.15),0_2px_12px_rgba(0,0,0,0.08)]"
          style={{ height: "76px" }}
        >
          {/* Left items: Home & Bundles */}
          {regularItems.map((item) => {
            const active = isActive(item.href);
            const badge = item.badge ?? 0;
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex flex-col items-center justify-end w-full pb-2.5 gap-0.5 relative"
              >
                <motion.div
                  whileTap={{ scale: 0.82 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="flex flex-col items-center gap-0.5"
                >
                  <div className="relative">
                    <motion.div
                      layout
                      className={`h-10 w-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                        active
                          ? "bg-gradient-to-br from-purple-500 to-blue-500 shadow-lg shadow-purple-500/30"
                          : ""
                      }`}
                    >
                      <item.icon
                        className={`h-5 w-5 transition-all duration-300 ${
                          active ? "text-white" : "text-[#9CA3AF]"
                        }`}
                        strokeWidth={active ? 2.5 : 2}
                      />
                    </motion.div>

                    <AnimatePresence>
                      {badge > 0 && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                          className="absolute -top-1 -right-1 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1 shadow-sm"
                        >
                          {badge > 99 ? "99+" : badge}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>

                  <span
                    className={`text-[10px] font-extrabold transition-all duration-300 ${
                      active ? "text-purple-600" : "text-[#9CA3AF]"
                    }`}
                  >
                    {item.label}
                  </span>
                </motion.div>
              </Link>
            );
          })}

          {/* Center: Top Up — floating circular button */}
          <Link
            href="/topup"
            className="flex flex-col items-center w-full relative"
            style={{ marginBottom: "-4px" }}
          >
            <motion.div
              whileTap={{ scale: 0.86 }}
              transition={{ type: "spring", stiffness: 400, damping: 18 }}
              className="flex flex-col items-center"
              style={{ transform: "translateY(-16px)" }}
            >
              <div
                className={`h-[56px] w-[56px] rounded-full flex items-center justify-center shadow-xl transition-all duration-300 ${
                  topupActive
                    ? "bg-gradient-to-br from-violet-500 to-blue-500 shadow-violet-500/50"
                    : "bg-gradient-to-br from-purple-600 to-violet-500 shadow-purple-600/40"
                }`}
              >
                <CreditCard className="h-6 w-6 text-white" strokeWidth={2.5} />
              </div>
              <span
                className={`text-[10px] font-extrabold mt-1 transition-all duration-300 ${
                  topupActive ? "text-purple-600" : "text-[#9CA3AF]"
                }`}
              >
                Top Up
              </span>
            </motion.div>
          </Link>

          {/* Right items: Chat & Profile */}
          {rightItems.map((item) => {
            const active = isActive(item.href);
            const badge = item.badge ?? 0;
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex flex-col items-center justify-end w-full pb-2.5 gap-0.5 relative"
              >
                <motion.div
                  whileTap={{ scale: 0.82 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  className="flex flex-col items-center gap-0.5"
                >
                  <div className="relative">
                    <motion.div
                      layout
                      className={`h-10 w-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                        active
                          ? "bg-gradient-to-br from-purple-500 to-blue-500 shadow-lg shadow-purple-500/30"
                          : ""
                      }`}
                    >
                      <item.icon
                        className={`h-5 w-5 transition-all duration-300 ${
                          active ? "text-white" : "text-[#9CA3AF]"
                        }`}
                        strokeWidth={active ? 2.5 : 2}
                      />
                    </motion.div>

                    <AnimatePresence>
                      {badge > 0 && (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          exit={{ scale: 0 }}
                          className="absolute -top-1 -right-1 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1 shadow-sm"
                        >
                          {badge > 99 ? "99+" : badge}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>

                  <span
                    className={`text-[10px] font-extrabold transition-all duration-300 ${
                      active ? "text-purple-600" : "text-[#9CA3AF]"
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
