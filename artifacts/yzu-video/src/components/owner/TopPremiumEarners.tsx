import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminFetch, fmtRp } from "@/lib/admin-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Search, Crown, Loader2, Trophy, TrendingUp, Users } from "lucide-react";

interface Earner {
  creatorId: string;
  username: string;
  avatar: string | null;
  role: string;
  totalSales: number;
  totalEarned: number;
  totalPlatformShare: number;
  totalRevenue: number;
  avgShareRate: number;
}

interface Response {
  data: Earner[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

const RANK_STYLES = [
  "bg-amber-100 text-amber-700 border-amber-300",
  "bg-slate-100 text-slate-600 border-slate-300",
  "bg-orange-100 text-orange-700 border-orange-300",
];

export function TopPremiumEarners() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching } = useQuery<Response>({
    queryKey: ["top-premium-earners", debounced],
    queryFn: () =>
      adminFetch<Response>(
        `/revenue/admin/top-premium-earners?search=${encodeURIComponent(debounced)}&limit=20`,
      ),
    staleTime: 30_000,
  });

  const earners = data?.data ?? [];
  const total = data?.pagination?.total ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white">
            <Crown className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-base">Top Pendapatan Video Premium</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              User/Meril yang mengupload video premium
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="gap-1 shrink-0">
          <Users className="h-3 w-3" /> {total} kreator
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari username kreator…"
            className="pl-9"
          />
          {isFetching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : earners.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Trophy className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              {debounced
                ? `Tidak ada kreator "${debounced}" dengan pendapatan premium.`
                : "Belum ada pendapatan dari video premium user/meril."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {earners.map((e, i) => (
              <div
                key={e.creatorId}
                className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 transition-colors hover:bg-slate-100"
              >
                {/* Rank */}
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm font-extrabold ${
                    RANK_STYLES[i] ?? "bg-slate-50 text-slate-400 border-slate-200"
                  }`}
                >
                  {i + 1}
                </div>

                {/* User */}
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <Avatar className="h-9 w-9 shrink-0 border border-slate-200">
                    <AvatarImage src={e.avatar || ""} alt={e.username} />
                    <AvatarFallback className="bg-purple-100 text-purple-700 text-xs font-bold">
                      {e.username.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {e.username}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="secondary"
                        className="border-none px-1.5 py-0 text-[10px] font-semibold capitalize"
                      >
                        {e.role}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        {e.totalSales} penjualan
                      </span>
                    </div>
                  </div>
                </div>

                {/* Earnings */}
                <div className="shrink-0 text-right">
                  <p className="text-sm font-extrabold text-emerald-600">
                    {fmtRp(e.totalEarned)}
                  </p>
                  <p className="flex items-center justify-end gap-0.5 text-[11px] text-muted-foreground">
                    <TrendingUp className="h-3 w-3" />
                    {Math.round(e.avgShareRate * 100)}% share
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer summary */}
        {earners.length > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-xs">
            <span className="text-muted-foreground">Total pendapatan platform (dari list)</span>
            <span className="font-bold text-slate-700">
              {fmtRp(earners.reduce((s, e) => s + e.totalPlatformShare, 0))}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
