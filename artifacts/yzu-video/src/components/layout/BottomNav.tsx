import { Link, useLocation } from "wouter";
import { Home as HomeIcon, ShoppingBag, Wallet, User, MessageCircle, Star } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";

/**
 * Mobile bottom navigation — 5 items (KIDZOO kid-friendly theme):
 *   Shop · Eksplore · Home (center star) · Pesan · Profil
 *
 * The center star is a raised, glowing gold button that navigates to the
 * Home landing page ("/"). The first item is "Shop" (was "Beranda/Home").
 */
export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  const isActive = (href: string) => {
    if (href === "/") return location === "/";
    return location.startsWith(href);
  };

  const sideItems = [
    { href: "/shop", icon: ShoppingBag, label: "Shop" },
    { href: "/topup", icon: Wallet, label: "Top Up" },
    { href: "/chat", icon: MessageCircle, label: "Pesan" },
    { href: user ? "/profile" : "/login", icon: User, label: "Profil" },
  ];

  const homeActive = isActive("/");

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-3 mb-3">
        <nav
          className="relative flex items-end justify-around rounded-[28px] backdrop-blur-xl border border-white/40 shadow-[0_8px_40px_rgba(79,70,229,0.18)]"
          style={{
            height: "68px",
            background: "linear-gradient(135deg, rgba(79,70,229,0.92) 0%, rgba(139,92,246,0.92) 100%)",
          }}
        >
          {/* Shop */}
          <SideLink item={sideItems[0]} active={isActive(sideItems[0].href)} />

          {/* Eksplore */}
          <SideLink item={sideItems[1]} active={isActive(sideItems[1].href)} />

          {/* Center: Home — floating glowing star button */}
          <Link
            href="/"
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
                className="h-[54px] w-[54px] rounded-full flex items-center justify-center shadow-xl transition-all duration-300"
                style={{
                  background: homeActive
                    ? "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)"
                    : "linear-gradient(135deg, #facc15 0%, #fbbf24 100%)",
                  boxShadow: homeActive
                    ? "0 0 20px 4px rgba(250,204,21,0.6), 0 4px 12px rgba(245,158,11,0.4)"
                    : "0 0 14px 2px rgba(250,204,21,0.45), 0 4px 10px rgba(245,158,11,0.3)",
                }}
              >
                <Star
                  className="h-7 w-7 text-white"
                  strokeWidth={2.5}
                  fill="white"
                />
              </div>
              <span
                className={`text-[10px] font-extrabold mt-1 transition-all duration-300 ${
                  homeActive ? "text-amber-300" : "text-white/70"
                }`}
              >
                Home
              </span>
            </motion.div>
          </Link>

          {/* Pesan */}
          <SideLink item={sideItems[2]} active={isActive(sideItems[2].href)} />

          {/* Profil */}
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
            active ? "bg-white/25 shadow-lg" : ""
          }`}
        >
          <item.icon
            className={`h-5 w-5 transition-all duration-300 ${active ? "text-white" : "text-white/60"}`}
            strokeWidth={active ? 2.5 : 2}
          />
        </div>
        <span
          className={`text-[10px] font-extrabold transition-all duration-300 ${
            active ? "text-white" : "text-white/60"
          }`}
        >
          {item.label}
        </span>
      </motion.div>
    </Link>
  );
}
