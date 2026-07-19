import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { Home, Gift, Crown, Wallet, Smile, MessageCircle } from "lucide-react";

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  // Unread chat badge
  const { data: chatUnread } = useQuery({
    queryKey: ["chat-nav-unread"],
    queryFn: async () => {
      const [chat, dm, ann] = await Promise.all([
        adminFetch<{ unread: number }>("/chat/unread").catch(() => ({ unread: 0 })),
        adminFetch<{ unread: number }>("/dm/unread").catch(() => ({ unread: 0 })),
        adminFetch<{ unread: number }>("/announcements-unread").catch(() => ({ unread: 0 })),
      ]);
      return Math.min((chat.unread ?? 0) + (dm.unread ?? 0) + (ann.unread ?? 0), 99);
    },
    refetchInterval: 15000,
    enabled: !!user,
  });

  const navItems = [
    { href: "/", icon: Home, label: "Home", activeColor: "text-purple-600" },
    { href: "/chat", icon: MessageCircle, label: "Chat", activeColor: "text-pink-500", badge: chatUnread ?? 0 },
    { href: "/bundles", icon: Gift, label: "Bundles", activeColor: "text-amber-500" },
    { href: "/subscriptions", icon: Crown, label: "Premium", activeColor: "text-orange-500" },
    { href: user ? "/profile" : "/login", icon: Smile, label: "Profile", activeColor: "text-blue-500" },
  ];

  return (
    <div 
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-100 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] rounded-t-3xl" 
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <nav className="flex justify-around items-center h-[68px] px-2">
        {navItems.map((item) => {
          const isActive = location === item.href ||
                           (item.href === "/chat" && location.startsWith("/chat")) ||
                           (item.href === "/bundles" && location.startsWith("/bundles")) || 
                           (item.href === "/subscriptions" && location.startsWith("/subscriptions"));
          const badge = (item as any).badge ?? 0;

          return (
            <Link key={item.label} href={item.href} className="flex flex-col items-center justify-center w-full h-full gap-1 relative">
              <div className="relative">
                <item.icon 
                  className={`h-6 w-6 transition-all duration-300 ${isActive ? `scale-110 ${item.activeColor} drop-shadow-sm` : 'text-slate-400'}`} 
                  strokeWidth={isActive ? 2.5 : 2} 
                />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center px-1 shadow-sm">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] font-extrabold transition-colors duration-300 ${isActive ? item.activeColor : 'text-slate-400'}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
