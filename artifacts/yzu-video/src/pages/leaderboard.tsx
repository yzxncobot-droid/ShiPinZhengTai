import { AppLayout } from "@/components/layout/AppLayout";
import { useGetTopupLeaderboard } from "@workspace/api-client-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trophy, Medal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<'daily'|'weekly'|'monthly'|'alltime'>('monthly');
  const { data: leaderboard, isLoading } = useGetTopupLeaderboard({ period });

  const getRankColor = (rank: number) => {
    switch(rank) {
      case 1: return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
      case 2: return "text-gray-300 bg-gray-300/10 border-gray-300/20";
      case 3: return "text-amber-700 bg-amber-700/10 border-amber-700/20";
      default: return "text-muted-foreground bg-muted border-border/50";
    }
  };

  const getRankIcon = (rank: number) => {
    switch(rank) {
      case 1: return <Trophy className="h-6 w-6 text-yellow-400" />;
      case 2: return <Medal className="h-6 w-6 text-gray-300" />;
      case 3: return <Medal className="h-6 w-6 text-amber-700" />;
      default: return <span className="font-bold text-lg">{rank}</span>;
    }
  };

  return (
    <AppLayout>
      <div className="container mx-auto px-4 md:px-6 py-12 max-w-4xl">
        <div className="text-center mb-12">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-4">
            <Trophy className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-4xl font-heading font-bold tracking-tight mb-4">Top Supporters</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Recognizing the users who contribute the most to our creator economy.
          </p>
          
          <div className="flex justify-center gap-2 mt-8 bg-muted/50 p-1.5 rounded-full w-fit mx-auto border border-border/50">
            {(['daily', 'weekly', 'monthly', 'alltime'] as const).map(p => (
              <Button
                key={p}
                variant="ghost"
                size="sm"
                onClick={() => setPeriod(p)}
                className={`rounded-full px-6 capitalize ${period === p ? 'bg-card shadow-sm font-medium' : 'text-muted-foreground'}`}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border/50 rounded-3xl overflow-hidden shadow-sm">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground animate-pulse">Loading rankings...</div>
          ) : !leaderboard || leaderboard.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">No data available for this period.</div>
          ) : (
            <div className="divide-y divide-border/50">
              {leaderboard.map((entry) => (
                <div key={entry.userId} className="flex items-center gap-6 p-4 sm:p-6 hover:bg-muted/20 transition-colors">
                  <div className={`w-12 h-12 rounded-full border flex items-center justify-center shrink-0 shadow-sm ${getRankColor(entry.rank)}`}>
                    {getRankIcon(entry.rank)}
                  </div>
                  
                  <Avatar className="h-12 w-12 border-2 border-background shadow-sm shrink-0">
                    <AvatarImage src={entry.avatar || ""} />
                    <AvatarFallback>{entry.username.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-semibold text-lg truncate">{entry.username}</p>
                    <p className="text-sm text-muted-foreground">Rank #{entry.rank}</p>
                  </div>
                  
                  <div className="text-right shrink-0">
                    <p className="font-bold text-lg">Rp {entry.totalAmount.toLocaleString()}</p>
                    <p className="text-xs text-primary font-medium uppercase tracking-wider">Contributed</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
