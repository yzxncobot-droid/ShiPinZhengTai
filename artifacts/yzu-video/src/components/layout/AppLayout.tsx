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
import { Search, User, Wallet, Bell, History, LayoutDashboard, LogOut, MessageCircle, Send, Globe2, UploadCloud, Film, Gift, Trophy, Play } from "lucide-react";
import { SiInstagram, SiTiktok, SiFacebook, SiYoutube, SiDiscord } from "react-icons/si";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { BottomNav } from "./BottomNav";

export function FunLogo({ className = "" }: { className?: string }) {
  return <YzuLogo className={className} />;
}

export function YzuLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      <div className="h-9 w-9 rounded-2xl bg-gradient-to-tr from-purple-600 to-violet-400 flex items-center justify-center shadow-md shadow-purple-500/25">
        <Play className="h-4.5 w-4.5 text-white fill-white ml-0.5" />
      </div>
      <div className="flex flex-col">
        <span className="text-xl font-black tracking-tight text-slate-800 leading-none" style={{ fontFamily: "'Nunito', sans-serif" }}>
          Yzu<span className="text-purple-600 font-extrabold ml-0.5">视频</span>
        </span>
        <span className="text-[9px] font-bold text-purple-500 tracking-wider uppercase leading-tight mt-0.5">
          Video Platform
        </span>
      </div>
    </div>
  );
}

export function Navbar() {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();

  const { data: customRoles } = useQuery<any[]>({
    queryKey: ["my-custom-roles"],
    queryFn: () => adminFetch("/users/me/custom-roles"),
    enabled: Boolean(user),
    staleTime: 60_000,
  });

  const isOwner = user?.role === "owner";
  const isAdmin = user?.role === "admin";
  const isBaseUser = user?.role === "user" || user?.role === "meril";

  const hasCustomUpload  = customRoles?.some((r: any) => r.permUploadVideo) ?? false;
  const hasCustomMyVideo = customRoles?.some((r: any) => r.permMyVideo)    ?? false;

  const canUpload  = isOwner || isAdmin || hasCustomUpload  || isBaseUser;
  const canMyVideo = isOwner || isAdmin || hasCustomMyVideo || isBaseUser;

  const handleLogout = () => {
    logout();
    setLocation('/login');
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-purple-100/60 bg-white/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-6 md:gap-10">
          <Link href="/" className="flex items-center">
            <YzuLogo />
          </Link>
          
          <nav className="hidden md:flex gap-6">
            <Link href="/" className={`text-sm font-extrabold transition-colors hover:text-purple-600 ${location === '/' ? 'text-purple-600' : 'text-slate-500'}`}>
              Home
            </Link>
            <Link href="/shop" className={`text-sm font-extrabold transition-colors hover:text-purple-600 ${location.startsWith('/shop') ? 'text-purple-600' : 'text-slate-500'}`}>
              Shop
            </Link>
            <Link href="/topup" className={`text-sm font-extrabold transition-colors hover:text-purple-600 ${location === '/topup' ? 'text-purple-600' : 'text-slate-500'}`}>
              Top Up
            </Link>
            <Link href="/info" className={`text-sm font-extrabold transition-colors hover:text-purple-600 ${location === '/info' ? 'text-purple-600' : 'text-slate-500'}`}>
              Info
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          <Button variant="ghost" size="icon" onClick={() => setLocation('/search')} className="rounded-full text-slate-500 hover:text-purple-600 hover:bg-purple-50">
            <Search className="h-5 w-5" />
            <span className="sr-only">Search</span>
          </Button>

          {user ? (
            <>
              <Link href="/notifications">
                <Button variant="ghost" size="icon" className="relative rounded-full text-slate-500 hover:text-purple-600 hover:bg-purple-50">
                  <Bell className="h-5 w-5" />
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500" />
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
                  <Button variant="ghost" className="relative h-9 w-9 rounded-full border-2 border-purple-200 p-0 hover:border-purple-400 transition-colors">
                    <Avatar className="h-full w-full">
                      <AvatarImage src={user.avatar || ""} alt={user.username} />
                      <AvatarFallback className="bg-purple-600 text-white font-bold text-xs">
                        {user.username?.charAt(0).toUpperCase() ?? "Y"}
                      </AvatarFallback>
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
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator className="my-1" />
                  
                  {(user.role === 'admin' || user.role === 'owner') && (
                    <>
                      <DropdownMenuItem onClick={() => setLocation(user.role === 'owner' ? '/owner' : '/admin')} className="cursor-pointer rounded-xl font-medium">
                        <LayoutDashboard className="mr-2 h-4 w-4 text-purple-600" />
                        <span>Owner Dashboard</span>
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
                      <UploadCloud className="mr-2 h-4 w-4 text-purple-500" />
                      <span>Upload Video</span>
                    </DropdownMenuItem>
                  )}
                  {canMyVideo && (
                    <DropdownMenuItem onClick={() => setLocation('/my-video')} className="cursor-pointer rounded-xl font-medium">
                      <Film className="mr-2 h-4 w-4 text-purple-500" />
                      <span>My Video</span>
                    </DropdownMenuItem>
                  )}

                  <DropdownMenuItem onClick={() => setLocation('/leaderboard')} className="cursor-pointer rounded-xl font-medium">
                    <Trophy className="mr-2 h-4 w-4 text-amber-500" />
                    <span>Leaderboard</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/topup')} className="cursor-pointer rounded-xl font-medium">
                    <Wallet className="mr-2 h-4 w-4 text-purple-600" />
                    <span>Top-up Wallet</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation('/history')} className="cursor-pointer rounded-xl font-medium">
                    <History className="mr-2 h-4 w-4 text-purple-500" />
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
              <Button variant="ghost" onClick={() => setLocation('/login')} className="hidden sm:inline-flex font-bold text-slate-600 rounded-full hover:text-purple-600">
                Log in
              </Button>
              <Button onClick={() => setLocation('/register')} className="rounded-full bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white font-bold shadow-md shadow-purple-500/20">
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
  const siteName = settings?.siteName || "Yzu视频";
  const socials = SOCIAL_LINKS.filter((s) => !!(settings as any)?.[s.key]);
  const hasContact = !!settings?.whatsappLink || !!settings?.telegramLink;

  return (
    <footer className="border-t border-purple-100 bg-white/90 py-10">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="space-y-4 md:col-span-1">
            <YzuLogo />
            <p className="text-slate-500 text-sm max-w-sm font-medium mt-3">
              {settings?.footerText || "Platform streaming video kartun dan edukasi menyenangkan untuk semua usia. Tonton gratis dan nikmati koleksi terbaik."}
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="font-heading font-extrabold text-slate-800">Menu Utama</h4>
            <ul className="space-y-2 text-sm font-medium text-slate-500">
              <li><Link href="/" className="hover:text-purple-600 transition-colors">Home</Link></li>
              <li><Link href="/shop" className="hover:text-purple-600 transition-colors">Shop</Link></li>
              <li><Link href="/topup" className="hover:text-purple-600 transition-colors">Top Up</Link></li>
              <li><Link href="/info" className="hover:text-purple-600 transition-colors">Info</Link></li>
              <li><Link href="/profile" className="hover:text-purple-600 transition-colors">Profil</Link></li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-heading font-extrabold text-slate-800">Hubungi Kami</h4>
            {hasContact ? (
              <ul className="space-y-2 text-sm font-medium text-slate-500">
                {settings?.whatsappLink && (
                  <li>
                    <a href={settings.whatsappLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-purple-600 transition-colors">
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  </li>
                )}
                {settings?.telegramLink && (
                  <li>
                    <a href={settings.telegramLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 hover:text-purple-600 transition-colors">
                      <Send className="h-4 w-4" /> Telegram
                    </a>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm font-medium text-slate-400">Hubungi kami melalui akun resmi.</p>
            )}
          </div>

          <div className="space-y-3">
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
                    className={`flex h-9 w-9 items-center justify-center rounded-full border bg-slate-50 text-slate-500 transition-all duration-300 shadow-sm ${hover}`}
                  >
                    <Icon className="h-4 w-4" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium text-slate-400">Ikuti info terbaru di media sosial kami.</p>
            )}
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-purple-100 text-center text-xs font-medium text-slate-400 flex flex-col md:flex-row justify-between items-center gap-2">
          <p>© {new Date().getFullYear()} {siteName}. All rights reserved.</p>
          <span className="text-purple-600 font-extrabold tracking-wider text-[10px] uppercase flex items-center gap-1 bg-purple-50 px-3 py-1 rounded-full">
            <Globe2 className="h-3 w-3" /> Yzu视频 Video Platform
          </span>
        </div>
      </div>
    </footer>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const isVideoDetail = location.startsWith("/videos/");

  return (
    <div className="relative flex min-h-[100dvh] flex-col text-foreground pb-[76px] md:pb-0 bg-[#fbf9ff]">
      {!isVideoDetail && <Navbar />}
      <main className="flex-1 w-full max-w-full overflow-x-hidden">{children}</main>
      {!isVideoDetail && <Footer />}
      <BottomNav />
    </div>
  );
}
