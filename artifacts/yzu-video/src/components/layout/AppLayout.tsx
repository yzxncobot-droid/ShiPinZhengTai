import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "@/lib/admin-api";
import { useGetSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Search, User, Wallet, Bell, History, LayoutDashboard, LogOut, MessageCircle, Send, Globe2, UploadCloud, Film, Gift, Trophy } from "lucide-react";
import { SiInstagram, SiTiktok, SiFacebook, SiYoutube, SiDiscord } from "react-icons/si";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { BottomNav } from "./BottomNav";

export function FunLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <div className="flex items-center">
        <span className="text-3xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-purple-600 via-pink-500 to-orange-500 drop-shadow-sm" style={{ fontFamily: "Outfit, sans-serif" }}>
          FUN<span className="text-blue-500">+</span>
        </span>
      </div>
      <div className="bg-purple-100 rounded-full px-2 py-0.5 -mt-1">
        <span className="text-[8px] font-extrabold text-purple-700 tracking-widest uppercase">Kids Video Platform</span>
      </div>
    </div>
  );
}

export function Navbar() {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();

  // Fetch user's active custom roles to check permissions
  const { data: customRoles } = useQuery<any[]>({
    queryKey: ["my-custom-roles"],
    queryFn: () => adminFetch("/users/me/custom-roles"),
    enabled: Boolean(user),
    staleTime: 60_000,
  });

  const isOwner = user?.role === "owner";
  const isAdmin = user?.role === "admin";

  // Permission comes exclusively from active custom roles (never badge flags)
  const hasCustomUpload  = customRoles?.some((r: any) => r.permUploadVideo) ?? false;
  const hasCustomMyVideo = customRoles?.some((r: any) => r.permMyVideo)    ?? false;

  const canUpload  = isOwner || isAdmin || hasCustomUpload;
  const canMyVideo = isOwner || isAdmin || hasCustomMyVideo;

  const handleLogout = () => {
    logout();
    setLocation('/login');
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-100 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="container mx-auto flex h-16 items-center px-4 md:px-6">
        <div className="flex items-center gap-6 md:gap-10">
          <Link href="/" className="flex items-center">
            <FunLogo />
          </Link>
          
          <nav className="hidden md:flex gap-6">
            <Link href="/" className={`text-sm font-extrabold transition-colors hover:text-purple-600 ${location === '/' ? 'text-purple-600' : 'text-slate-500'}`}>
              Home
            </Link>
            <Link href="/bundles" className={`text-sm font-extrabold transition-colors hover:text-purple-600 ${location.startsWith('/bundles') ? 'text-purple-600' : 'text-slate-500'}`}>
              Bundles
            </Link>
            <Link href="/topup" className={`text-sm font-extrabold transition-colors hover:text-purple-600 ${location === '/topup' ? 'text-purple-600' : 'text-slate-500'}`}>
              Top Up
            </Link>
            <Link href="/chat" className={`text-sm font-extrabold transition-colors hover:text-purple-600 ${location.startsWith('/chat') ? 'text-purple-600' : 'text-slate-500'}`}>
              Chat
            </Link>
          </nav>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 md:gap-4">
          <Button variant="ghost" size="icon" onClick={() => setLocation('/search')} className="text-slate-500 hover:text-purple-600 hover:bg-purple-50">
            <Search className="h-5 w-5" />
            <span className="sr-only">Search</span>
          </Button>

          {user ? (
            <>
              <Link href="/notifications">
                <Button variant="ghost" size="icon" className="relative text-slate-500 hover:text-purple-600 hover:bg-purple-50">
                  <Bell className="h-5 w-5" />
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-orange-500" />
                  <span className="sr-only">Notifications</span>
                </Button>
              </Link>
              
              <Link href="/topup" className="hidden sm:flex">
                <Button variant="outline" className="gap-2 border-purple-200 bg-purple-50 hover:bg-purple-100 rounded-full h-9">
                  <Wallet className="h-4 w-4 text-purple-600" />
                  <span className="font-extrabold text-purple-700">Rp {user.walletBalance?.toLocaleString() || 0}</span>
                </Button>
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-10 w-10 rounded-full border-2 border-purple-200 p-0 hover:border-purple-400 transition-colors">
                    <Avatar className="h-9 w-9">
                      <AvatarImage src={user.avatar || ""} alt={user.username} />
                      <AvatarFallback className="bg-purple-100 text-purple-700 font-bold">{user.username.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 rounded-2xl p-2" align="end" forceMount>
                  <DropdownMenuLabel className="font-normal px-2 py-1.5">
                    <div className="flex flex-col space-y-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-extrabold leading-none text-slate-800">{user.username}</p>
                      </div>
                      <p className="text-xs leading-none text-slate-500 mt-1">
                        {user.email}
                      </p>
                    </div>
                    {customRoles && customRoles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {customRoles.slice(0, 2).map((r: any) => (
                          <Badge
                            key={r.id}
                            variant="secondary"
                            className="border-none font-bold text-[10px]"
                            style={{
                              backgroundColor: `${r.color}20`,
                              color: r.color,
                            }}
                          >
                            {r.emoji && <span className="mr-1">{r.emoji}</span>}
                            {r.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="my-1" />
                  
                  {(user.role === 'admin' || user.role === 'owner') && (
                    <>
                      <DropdownMenuItem onClick={() => setLocation(user.role === 'owner' ? '/owner' : '/admin')} className="cursor-pointer rounded-xl font-medium">
                        <LayoutDashboard className="mr-2 h-4 w-4 text-blue-500" />
                        <span>Dashboard</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator className="my-1" />
                    </>
                  )}
                  
                  <DropdownMenuItem onClick={() => setLocation('/profile')} className="cursor-pointer rounded-xl font-medium">
                    <User className="mr-2 h-4 w-4 text-purple-500" />
                    <span>Profile</span>
                  </DropdownMenuItem>

                  {canUpload && (
                    <DropdownMenuItem onClick={() => setLocation('/upload')} className="cursor-pointer rounded-xl font-medium">
                      <UploadCloud className="mr-2 h-4 w-4 text-pink-500" />
                      <span>Upload Video</span>
                    </DropdownMenuItem>
                  )}
                  {canMyVideo && (
                    <DropdownMenuItem onClick={() => setLocation('/my-video')} className="cursor-pointer rounded-xl font-medium">
                      <Film className="mr-2 h-4 w-4 text-violet-500" />
                      <span>My Video</span>
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuItem onClick={() => setLocation('/leaderboard')} className="cursor-pointer rounded-xl font-medium">
                    <Trophy className="mr-2 h-4 w-4 text-yellow-500" />
                    <span>Leaderboard</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/redeem')} className="cursor-pointer rounded-xl font-medium">
                    <Gift className="mr-2 h-4 w-4 text-purple-500" />
                    <span>Code Redeem</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/topup')} className="cursor-pointer rounded-xl font-medium">
                    <Wallet className="mr-2 h-4 w-4 text-orange-500" />
                    <span>Top-up Wallet</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/history')} className="cursor-pointer rounded-xl font-medium">
                    <History className="mr-2 h-4 w-4 text-sky-500" />
                    <span>History</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuItem onClick={handleLogout} className="cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 rounded-xl font-medium">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setLocation('/login')} className="hidden sm:inline-flex font-bold text-slate-600 rounded-full">
                Log in
              </Button>
              <Button onClick={() => setLocation('/register')} className="rounded-full bg-purple-600 hover:bg-purple-700 text-white font-bold">
                Sign up
              </Button>
            </div>
          )}

        </div>
      </div>
    </header>
  );
}

const SOCIAL_LINKS = [
  { key: "instagramLink" as const, label: "Instagram", Icon: SiInstagram, hover: "hover:bg-[#E4405F] hover:text-white border-slate-200" },
  { key: "tiktokLink" as const, label: "TikTok", Icon: SiTiktok, hover: "hover:bg-black hover:text-white border-slate-200" },
  { key: "facebookLink" as const, label: "Facebook", Icon: SiFacebook, hover: "hover:bg-[#1877F2] hover:text-white border-slate-200" },
  { key: "youtubeLink" as const, label: "YouTube", Icon: SiYoutube, hover: "hover:bg-[#FF0000] hover:text-white border-slate-200" },
  { key: "discordLink" as const, label: "Discord", Icon: SiDiscord, hover: "hover:bg-[#5865F2] hover:text-white border-slate-200" },
];

export function Footer() {
  const { data: settings } = useGetSettings();
  const siteName = settings?.siteName || "FUN+";
  const socials = SOCIAL_LINKS.filter((s) => !!(settings as any)?.[s.key]);
  const hasContact = !!settings?.whatsappLink || !!settings?.telegramLink;

  return (
    <footer className="border-t border-slate-100 bg-white py-12 md:py-16">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4 md:col-span-1">
            <FunLogo className="items-start" />
            <p className="text-slate-500 text-sm max-w-sm font-medium mt-4">
              {settings?.footerText || "The best video platform for kids. Discover, watch, and learn in a safe, fun, and colorful environment."}
            </p>
          </div>

          <div className="space-y-4">
            <h4 className="font-heading font-extrabold text-slate-800">Links</h4>
            <ul className="space-y-2 text-sm font-medium text-slate-500">
              <li><Link href="/" className="hover:text-purple-600 transition-colors">Home</Link></li>
              <li><Link href="/bundles" className="hover:text-purple-600 transition-colors">Bundles</Link></li>
              <li><Link href="/leaderboard" className="hover:text-purple-600 transition-colors">Leaderboard</Link></li>
              <li><Link href="/search" className="hover:text-purple-600 transition-colors">Search</Link></li>
            </ul>
          </div>

          <div className="space-y-4">
            <h4 className="font-heading font-extrabold text-slate-800">Hubungi Kami</h4>
            {hasContact ? (
              <ul className="space-y-2 text-sm font-medium text-slate-500">
                {settings?.whatsappLink && (
                  <li>
                    <a href={settings.whatsappLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-green-600 transition-colors">
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  </li>
                )}
                {settings?.telegramLink && (
                  <li>
                    <a href={settings.telegramLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-sky-500 transition-colors">
                      <Send className="h-4 w-4" /> Telegram
                    </a>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm font-medium text-slate-400">Belum ada kontak dikonfigurasi</p>
            )}
          </div>

          <div className="space-y-4">
            <h4 className="font-heading font-extrabold text-slate-800">Media Sosial</h4>
            {socials.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {socials.map(({ key, label, Icon, hover }) => (
                  <a
                    key={key}
                    href={(settings as any)[key]}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    title={label}
                    className={`flex h-10 w-10 items-center justify-center rounded-full border bg-slate-50 text-slate-500 transition-all duration-300 shadow-sm ${hover}`}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium text-slate-400">Belum ada media sosial</p>
            )}
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-100 text-center text-sm font-medium text-slate-400 flex flex-col md:flex-row justify-between items-center">
          <p>© {new Date().getFullYear()} {siteName}. All rights reserved.</p>
          <div className="mt-4 md:mt-0 flex gap-4">
            <span className="text-purple-600 font-extrabold tracking-wider text-[10px] uppercase flex items-center gap-1.5 bg-purple-50 px-3 py-1.5 rounded-full">
              <Globe2 className="h-3.5 w-3.5" /> Kids Video Platform
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isVideoDetail = location.startsWith("/videos/");

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-slate-50 text-foreground pb-[68px] md:pb-0">
      {!isVideoDetail && <Navbar />}
      <main className="flex-1 w-full max-w-full overflow-x-hidden">{children}</main>
      {!isVideoDetail && <Footer />}
      <BottomNav />
    </div>
  );
}
