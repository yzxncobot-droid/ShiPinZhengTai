/**
 * CreateDropModal
 * Allows Owner and Admin to create a Drop directly inside a chat room.
 */
import { useState } from "react";
import { adminFetch } from "@/lib/admin-api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Gift, Coins, Star, Ticket, Zap, BadgeCheck, Package } from "lucide-react";

const REWARD_TYPES = [
  { value: "wallet_balance",       label: "Wallet Balance",      icon: Coins,     placeholder: "Amount (e.g. 50000)" },
  { value: "premium_subscription", label: "Premium Subscription", icon: Star,     placeholder: "Days (e.g. 30)" },
  { value: "coupon",               label: "Coupon",               icon: Ticket,   placeholder: "Coupon code" },
  { value: "custom",               label: "Custom Reward",        icon: Gift,     placeholder: "Reward description" },
  { value: "badge",                label: "Verification Badge",   icon: BadgeCheck, placeholder: "Badge type" },
  { value: "redeem_code",          label: "Redeem Code",          icon: Ticket,   placeholder: "Code value" },
];

interface Props {
  roomId: string;
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

export function CreateDropModal({ roomId, open, onClose, onCreated }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [rewardType, setRewardType] = useState("wallet_balance");
  const [rewardValue, setRewardValue] = useState("");
  const [maxWinners, setMaxWinners] = useState("20");
  const [startNow, setStartNow] = useState(true);
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState("60"); // minutes

  const handleCreate = async () => {
    if (!title.trim()) { toast({ title: "Title is required", variant: "destructive" }); return; }
    if (!rewardValue.trim()) { toast({ title: "Reward value is required", variant: "destructive" }); return; }
    if (!maxWinners || parseInt(maxWinners) < 1) { toast({ title: "Invalid quantity", variant: "destructive" }); return; }

    setLoading(true);
    try {
      const now = new Date();
      const start = startNow ? now : new Date(startTime);
      const end = new Date(start.getTime() + parseInt(duration) * 60 * 1000);

      await adminFetch("/drops", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          rewardType,
          rewardValue: rewardValue.trim(),
          rewardAmount: ["wallet_balance", "coins"].includes(rewardType) ? parseFloat(rewardValue) : undefined,
          maxWinners: parseInt(maxWinners),
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          roomId,
        }),
      });

      toast({ title: "🎁 Drop created!", description: `"${title}" is now live in the room.` });
      setTitle(""); setDescription(""); setRewardValue(""); setMaxWinners("20"); setDuration("60");
      onClose();
      onCreated?.();
    } catch (e: any) {
      toast({ title: "Failed to create drop", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const selectedType = REWARD_TYPES.find(r => r.value === rewardType);
  const RewardIcon = selectedType?.icon ?? Gift;

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Gift className="h-4 w-4 text-white" />
            </div>
            Create Drop
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <Label className="text-xs text-slate-500">Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Lucky Drop 🎉" className="mt-1" maxLength={60} />
          </div>

          {/* Description */}
          <div>
            <Label className="text-xs text-slate-500">Description (optional)</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Short description..." className="mt-1" maxLength={120} />
          </div>

          {/* Reward Type */}
          <div>
            <Label className="text-xs text-slate-500">Reward Type</Label>
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              {REWARD_TYPES.map(r => {
                const Icon = r.icon;
                return (
                  <button key={r.value} onClick={() => setRewardType(r.value)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-bold border-2 transition-all text-left
                      ${rewardType === r.value ? "border-purple-500 bg-purple-50 text-purple-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{r.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reward Value */}
          <div>
            <Label className="text-xs text-slate-500">
              {rewardType === "wallet_balance" ? "Amount (Rp)" : "Reward Value"} *
            </Label>
            <div className="relative mt-1">
              <Input value={rewardValue} onChange={e => setRewardValue(e.target.value)}
                placeholder={selectedType?.placeholder ?? "Value..."} type={["wallet_balance", "coins"].includes(rewardType) ? "number" : "text"} />
            </div>
          </div>

          {/* Quantity + Duration */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-slate-500">Total Slots</Label>
              <Input value={maxWinners} onChange={e => setMaxWinners(e.target.value)}
                type="number" min="1" max="9999" className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-slate-500">Duration (minutes)</Label>
              <Input value={duration} onChange={e => setDuration(e.target.value)}
                type="number" min="1" max="10080" className="mt-1" />
            </div>
          </div>

          {/* Start time */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                <input type="checkbox" checked={startNow} onChange={e => setStartNow(e.target.checked)} />
                Start immediately
              </label>
            </div>
            {!startNow && (
              <Input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} />
            )}
          </div>

          {/* Preview */}
          {title && (
            <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-100 rounded-2xl p-3">
              <p className="text-[10px] font-bold text-purple-500 uppercase tracking-wider mb-1.5">Preview</p>
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                  <RewardIcon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs font-black text-slate-800">{title}</p>
                  <p className="text-lg font-black text-purple-600 leading-tight">{rewardValue || "—"}</p>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">
                {maxWinners || 0} slots · {duration} minutes
              </p>
            </div>
          )}

          <Button onClick={handleCreate} disabled={loading} className="w-full bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold">
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            🎁 Publish Drop
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
