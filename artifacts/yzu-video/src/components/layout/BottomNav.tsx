import { Link, useLocation } from "wouter";
import { Home, ShoppingBag, CreditCard, User, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";

/**
 * Mobile bottom navigation — 5 items:
 *   Home · Shop · Top Up · Chat · Profile
 */
export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location.startsWith(href);
  };

  const sideItems = [
    { href: "/", icon: Home, label: "Home" },
    { href: "/shop", icon: ShoppingBag, label: "Shop" },
    { href: "/chat", icon: MessageCircle, label: "Chat" },
    { href: user ? "/profile" : "/login", icon: User, label: "Profile" },
  ];

  const topupActive = isActive("/topup");

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-3 mb-3">
        <nav
          className="relative flex items-end justify-around rounded-[28px] bg-white/85 backdrop-blur-xl border border-slate-200 shadow-[0_8px_40px_rgba(0,0,0,0.08)]"
          style={{ height: "68px" }}
        >
          {/* Home */}
          <SideLink item={sideItems[0]} active={isActive(sideItems[0].href)} />

          {/* Shop */}
          <SideLink item={sideItems[1]} active={isActive(sideItems[1].href)} />

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
                className={`h-[54px] w-[54px] rounded-full flex items-center justify-center shadow-xl transition-all duration-300 ${
                  topupActive
                    ? "bg-gradient-to-br from-amber-400 to-orange-500 shadow-orange-500/50"
                    : "bg-gradient-to-br from-amber-400 to-orange-500 shadow-orange-500/40"
                }`}
              >
                <CreditCard className="h-6 w-6 text-white" strokeWidth={2.5} />
              </div>
              <span
                className={`text-[10px] font-extrabold mt-1 transition-all duration-300 ${
                  topupActive ? "text-amber-500" : "text-slate-400"
                }`}
              >
                Top Up
              </span>
            </motion.div>
          </Link>

          {/* Chat */}
          <SideLink item={sideItems[2]} active={isActive(sideItems[2].href)} />

          {/* Profile */}
          <SideLink item={sideItems[3]} active={isActive(sideItems[3].href)} />
        </nav>
      </div>
    </div>
  );
}

function SideLink({
  item,
  active,
}: {
  item: { href: string; icon: React.ElementType; label: string };
  active: boolean;
}) {
  return (
    <Link href={item.href} className="flex flex-col items-center justify-end w-full pb-2.5 gap-0.5 relative">
      <motion.div
        whileTap={{ scale: 0.82 }}
        transition={{ type: "spring", stiffness: 400, damping: 20 }}
        className="flex flex-col items-center gap-0.5"
      >
        <div
          className={`h-10 w-10 rounded-full flex items-center justify-center transition-all duration-300 ${
            active ? "bg-gradient-to-br from-purple-500 to-violet-500 shadow-lg shadow-purple-500/30" : ""
          }`}
        >
          <item.icon
            className={`h-5 w-5 transition-all duration-300 ${active ? "text-white" : "text-slate-400"}`}
            strokeWidth={active ? 2.5 : 2}
          />
        </div>
        <span
          className={`text-[10px] font-extrabold transition-all duration-300 ${
            active ? "text-purple-600" : "text-slate-400"
          }`}
        >
          {item.label}
        </span>
      </motion.div>
    </Link>
  );
}
