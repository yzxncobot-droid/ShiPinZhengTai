import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Home, Compass, Crown, Wallet, Smile } from "lucide-react";

export function BottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();

  const navItems = [
    { href: "/", icon: Home, label: "Home", activeColor: "text-purple-600" },
    { href: "/search", icon: Compass, label: "Explore", activeColor: "text-purple-600" },
    { href: "/subscriptions", icon: Crown, label: "Premium", activeColor: "text-amber-500" },
    { href: "/topup", icon: Wallet, label: "Top Up", activeColor: "text-orange-500" },
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
                           (item.href === "/search" && location.startsWith("/search")) || 
                           (item.href === "/subscriptions" && location.startsWith("/subscriptions"));
                           
          return (
            <Link key={item.label} href={item.href} className="flex flex-col items-center justify-center w-full h-full gap-1">
              <item.icon 
                className={`h-6 w-6 transition-all duration-300 ${isActive ? `scale-110 ${item.activeColor} drop-shadow-sm` : 'text-slate-400'}`} 
                strokeWidth={isActive ? 2.5 : 2} 
              />
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
