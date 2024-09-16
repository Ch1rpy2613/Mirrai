import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Wifi, WifiOff, Settings2, Sliders, ChevronDown, ChevronUp, Check,
  User, Shield, Database, Download, Trash2, KeyRound, Mail, Calendar,
  MessageCircle, FileText, HardDrive, Users, Clock, Pencil, AlertTriangle,
  Leaf, Eye, EyeOff,
} from "lucide-react";
import { toast } from "sonner";

// ─── TAB CONFIG ──────────────────────────────────────────────────────────────

const TABS = [
  { key: "profile", label: "个人资料", icon: User },
  { key: "ai", label: "AI 设置", icon: Settings2 },
  { key: "wechat", label: "微信", icon: Wifi },
  { key: "data", label: "数据管理", icon: Database },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ─── SLIDER FIELD ────────────────────────────────────────────────────────────

function SliderField({ label, value, onChange, min, max, step, unit }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm text-foreground/70">{label}</Label>
        <span className="text-sm font-medium text-foreground">{value}{unit}</span>
      </div>
// ─── SLIDER_PLACEHOLDER ──────────────────────────────────────────────────────
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary" />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ─── PROVIDER CONFIG ROW ─────────────────────────────────────────────────────

function ProviderConfigRow({ provider, onSave, onSetDefault }: {
  provider: { name: string; configured: boolean };
  onSave: (data: { providerName: string; apiKey?: string; baseUrl?: string; model?: string }) => void;
  onSetDefault: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground font-medium">{provider.name}</span>
          <span className={`text-xs ${provider.configured ? "text-emerald-500" : "text-muted-foreground"}`}>
            {provider.configured ? "已配置" : "未配置"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span onClick={e => { e.stopPropagation(); onSetDefault(); }}
            className="text-xs text-primary hover:text-primary/80 cursor-pointer">设为默认</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>
      {expanded && (
        <div className="p-3 pt-0 space-y-3 border-t border-border">
          <div>
            <Label className="text-xs text-foreground/70">API Key</Label>
            <Input value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..." type="password" className="h-9 bg-muted/50 border-border rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-foreground/70">Base URL</Label>
              <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1" className="h-9 bg-muted/50 border-border rounded-lg text-sm" />
            </div>
            <div>
              <Label className="text-xs text-foreground/70">Model</Label>
              <Input value={model} onChange={e => setModel(e.target.value)}
                placeholder="gpt-4o" className="h-9 bg-muted/50 border-border rounded-lg text-sm" />
            </div>
          </div>
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
            onClick={() => {
              onSave({ providerName: provider.name, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined, model: model || undefined });
              setExpanded(false);
            }}>
            <Check className="w-3.5 h-3.5 mr-1" />保存
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── STAT ITEM ───────────────────────────────────────────────────────────────

function StatItem({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl">
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Icon className="w-4 h-4 text-primary/70" />
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

// ─── PROFILE TAB ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const { data: profile, refetch } = trpc.user.getProfile.useQuery();
  const { data: accountStats } = trpc.user.getAccountStats.useQuery();
  const updateProfile = trpc.user.updateProfile.useMutation({
    onSuccess: () => { toast.success("资料已更新"); refetch(); setEditing(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => { toast.success("密码已修改"); setShowPasswordDialog(false); setCurrentPwd(""); setNewPwd(""); setConfirmPwd(""); },
    onError: (e: any) => toast.error(e.message),
  });

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);

  useEffect(() => {
    if (profile) {
      setEditName(profile.name || "");
      setEditEmail(profile.email || "");
    }
  }, [profile]);

  if (!profile) return <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>;

  const memberDays = Math.max(1, Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86400000));

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6">
      {/* Avatar + Basic Info */}
      <div className="warm-card p-6">
        <div className="flex items-start gap-5">
          <div className="relative">
            <div className="w-20 h-20 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
              <span className="text-3xl font-bold text-primary">{(profile.name || profile.username).charAt(0).toUpperCase()}</span>
            </div>
            <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-emerald-500 border-2 border-card flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">昵称</Label>
                  <Input value={editName} onChange={e => setEditName(e.target.value)}
                    className="h-9 bg-muted/50 border-border rounded-xl text-sm mt-1" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">邮箱</Label>
                  <Input value={editEmail} onChange={e => setEditEmail(e.target.value)}
                    type="email" placeholder="your@email.com"
                    className="h-9 bg-muted/50 border-border rounded-xl text-sm mt-1" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
                    onClick={() => updateProfile.mutate({ name: editName.trim() || undefined, email: editEmail.trim() || undefined })}
                    disabled={updateProfile.isPending}>
                    {updateProfile.isPending ? "保存中..." : "保存"}
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setEditing(false)}>取消</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-semibold text-foreground">{profile.name || profile.username}</h2>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{profile.role}</span>
                </div>
                <p className="text-sm text-muted-foreground">@{profile.username}</p>
                {profile.email && (
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                    <Mail className="w-3 h-3" /> {profile.email}
                  </div>
                )}
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> 加入 {memberDays} 天
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> 上次登录 {new Date(profile.lastSignedIn).toLocaleDateString("zh-CN")}
                  </span>
                </div>
                <Button size="sm" variant="ghost" className="mt-3 text-xs text-primary hover:text-primary/80 rounded-xl h-7 px-2"
                  onClick={() => setEditing(true)}>
                  <Pencil className="w-3 h-3 mr-1" /> 编辑资料
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Account Stats */}
      {accountStats && (
        <div className="warm-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
            <Database className="w-4 h-4 text-primary/60" /> 账户统计
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatItem icon={Users} label="数字分身" value={accountStats.totalPersonas} />
            <StatItem icon={MessageCircle} label="总对话次数" value={accountStats.totalChats} />
            <StatItem icon={MessageCircle} label="总消息数" value={accountStats.totalMessages} />
            <StatItem icon={FileText} label="上传文件" value={accountStats.totalFiles} />
            <StatItem icon={HardDrive} label="存储空间" value={formatBytes(accountStats.storageUsed)} />
            <StatItem icon={Calendar} label="使用天数" value={memberDays} />
          </div>
        </div>
      )}

      {/* Security */}
      <div className="warm-card p-5">
        <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary/60" /> 安全设置
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-muted/20 rounded-xl">
            <div className="flex items-center gap-3">
              <KeyRound className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-foreground">登录密码</p>
                <p className="text-xs text-muted-foreground">定期修改密码以保护账户安全</p>
              </div>
            </div>
            <Button size="sm" variant="outline" className="rounded-xl text-xs border-border"
              onClick={() => setShowPasswordDialog(true)}>
              修改密码
            </Button>
          </div>
          {profile.loginMethod && (
            <div className="flex items-center gap-3 p-3 bg-muted/20 rounded-xl">
              <Shield className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-foreground">登录方式</p>
                <p className="text-xs text-muted-foreground">{profile.loginMethod}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader><DialogTitle className="text-foreground">修改密码</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">当前密码</Label>
              <div className="relative">
                <Input value={currentPwd} onChange={e => setCurrentPwd(e.target.value)}
                  type={showCurrentPwd ? "text" : "password"} placeholder="输入当前密码"
                  className="h-10 bg-muted/50 border-border rounded-xl pr-10" />
                <button onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">新密码</Label>
              <div className="relative">
                <Input value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  type={showNewPwd ? "text" : "password"} placeholder="至少 6 位"
                  className="h-10 bg-muted/50 border-border rounded-xl pr-10" />
                <button onClick={() => setShowNewPwd(!showNewPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {newPwd && newPwd.length < 6 && (
                <p className="text-xs text-destructive">密码至少需要 6 个字符</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">确认新密码</Label>
              <Input value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                type="password" placeholder="再次输入新密码"
                className="h-10 bg-muted/50 border-border rounded-xl" />
              {confirmPwd && confirmPwd !== newPwd && (
                <p className="text-xs text-destructive">两次输入的密码不一致</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPasswordDialog(false)} className="rounded-xl">取消</Button>
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
              disabled={!currentPwd || newPwd.length < 6 || newPwd !== confirmPwd || changePassword.isPending}
              onClick={() => changePassword.mutate({ currentPassword: currentPwd, newPassword: newPwd })}>
              {changePassword.isPending ? "修改中..." : "确认修改"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── AI SETTINGS TAB ─────────────────────────────────────────────────────────

function AISettingsTab() {
  const providers = trpc.llmConfig.listProviders.useQuery();
  const defaultConfig = trpc.llmConfig.getDefault.useQuery();
  const upsertConfig = trpc.llmConfig.upsert.useMutation({
    onSuccess: () => { toast.success("配置已保存"); providers.refetch(); },
  });
  const setDefault = trpc.llmConfig.setDefault.useMutation({
    onSuccess: () => { toast.success("默认提供商已更新"); defaultConfig.refetch(); },
  });
  const updateExtra = trpc.llmConfig.updateExtraConfig.useMutation({
    onSuccess: () => { toast.success("对话参数已保存"); defaultConfig.refetch(); },
  });

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [contextLimit, setContextLimit] = useState(20);

  useEffect(() => {
    if (defaultConfig.data?.extraConfig) {
      const e = defaultConfig.data.extraConfig as any;
      if (e.temperature != null) setTemperature(e.temperature);
      if (e.maxTokens != null) setMaxTokens(e.maxTokens);
      if (e.contextLimit != null) setContextLimit(e.contextLimit);
    }
  }, [defaultConfig.data]);

  return (
    <div className="space-y-6">
      <section className="warm-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">AI 提供商</h2>
          {defaultConfig.data && (
            <span className="text-xs text-muted-foreground ml-auto">
              当前默认: <span className="text-primary font-medium">{defaultConfig.data.providerName}</span>
            </span>
          )}
        </div>
        <div className="space-y-2">
          {providers.data?.map(p => (
            <ProviderConfigRow key={p.name} provider={p}
              onSave={data => upsertConfig.mutate(data)}
              onSetDefault={() => setDefault.mutate({ providerName: p.name })} />
          ))}
        </div>
      </section>

      <section className="warm-card p-5 space-y-5">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-primary" />
          <h2 className="font-semibold text-foreground">对话参数</h2>
        </div>
        <SliderField label="Temperature（创造性）" value={temperature} onChange={setTemperature}
          min={0} max={2} step={0.1} />
        <SliderField label="Max Tokens（最大回复长度）" value={maxTokens} onChange={setMaxTokens}
          min={256} max={8192} step={256} />
        <SliderField label="上下文消息数" value={contextLimit} onChange={setContextLimit}
          min={5} max={50} step={5} unit=" 条" />
        <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
          onClick={() => updateExtra.mutate({ extraConfig: { temperature, maxTokens, contextLimit } })}
          disabled={updateExtra.isPending}>
          {updateExtra.isPending ? "保存中..." : "保存参数"}
        </Button>
      </section>
    </div>
  );
}

// ─── WECHAT TAB ──────────────────────────────────────────────────────────────

function WeChatTab() {
  const wechatStatus = trpc.wechat.getStatus.useQuery(undefined, { refetchInterval: 3000 });
  const startBot = trpc.wechat.start.useMutation({ onSuccess: () => toast.success("微信机器人启动中...") });
  const stopBot = trpc.wechat.stop.useMutation({ onSuccess: () => toast.success("微信机器人已停止") });
  const bot = wechatStatus.data;

  return (
    <div className="space-y-6">
      <section className="warm-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          {bot?.status === "logged_in"
            ? <Wifi className="w-5 h-5 text-emerald-500" />
            : <WifiOff className="w-5 h-5 text-muted-foreground" />}
          <h2 className="font-semibold text-foreground">微信机器人</h2>
          <span className="text-sm text-muted-foreground ml-auto">
            {bot?.status === "logged_in" && `已登录: ${bot.loggedInUser}`}
            {bot?.status === "scanning" && "等待扫码..."}
            {bot?.status === "stopped" && "未启动"}
            {bot?.status === "error" && "出错"}
          </span>
        </div>

        <div className="p-4 bg-muted/20 rounded-xl">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-3 h-3 rounded-full ${
              bot?.status === "logged_in" ? "bg-emerald-500" :
              bot?.status === "scanning" ? "bg-blue-400 animate-pulse" :
              bot?.status === "error" ? "bg-red-400" : "bg-muted-foreground/30"
            }`} />
            <span className="text-sm text-foreground font-medium">
              {bot?.status === "logged_in" ? "在线运行中" :
               bot?.status === "scanning" ? "等待扫码登录" :
               bot?.status === "error" ? "运行出错" : "未启动"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            启动微信机器人后，绑定的分身可以通过微信自动回复消息。扫码登录你的微信账号即可开始使用。
          </p>
        </div>

        {bot?.qrCodeUrl && (
          <div className="flex flex-col items-center gap-3 py-4">
            <img src={bot.qrCodeUrl} alt="WeChat QR" className="w-48 h-48 rounded-xl border border-border" />
            <p className="text-xs text-muted-foreground">请使用微信扫描二维码登录</p>
          </div>
        )}

        <div className="flex gap-2">
          <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl"
            onClick={() => startBot.mutate()}
            disabled={bot?.status === "logged_in" || bot?.status === "scanning"}>
            启动
          </Button>
          <Button size="sm" variant="outline" className="rounded-xl border-border"
            onClick={() => stopBot.mutate()} disabled={bot?.status === "stopped"}>
            停止
          </Button>
        </div>
      </section>
    </div>
  );
}

// ─── DATA MANAGEMENT TAB ─────────────────────────────────────────────────────

function DataManagementTab() {
  const [, navigate] = useLocation();
  const { logout } = useAuth();
  const { data: accountStats } = trpc.user.getAccountStats.useQuery();
  const exportData = trpc.user.exportData.useMutation({
    onSuccess: (data) => {
      if (!data) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `presence-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("数据导出成功");
    },
    onError: (e: any) => toast.error("导出失败：" + e.message),
  });

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const deleteAccount = trpc.user.deleteAccount.useMutation({
    onSuccess: () => {
      toast.success("账户已删除");
      logout();
      navigate(getLoginUrl());
    },
    onError: (e: any) => toast.error(e.message),
  });

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-6">
      {/* Storage Overview */}
      {accountStats && (
        <section className="warm-card p-5">
          <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-primary/60" /> 存储概览
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">已用空间</span>
              <span className="font-medium text-foreground">{formatBytes(accountStats.storageUsed)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary/60 rounded-full transition-all"
                style={{ width: `${Math.min(100, (accountStats.storageUsed / (100 * 1048576)) * 100)}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalPersonas}</div>
                <div className="text-[10px] text-muted-foreground">分身</div>
              </div>
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalMessages}</div>
                <div className="text-[10px] text-muted-foreground">消息</div>
              </div>
              <div className="text-center p-2 bg-muted/20 rounded-lg">
                <div className="text-sm font-semibold text-foreground">{accountStats.totalFiles}</div>
                <div className="text-[10px] text-muted-foreground">文件</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Export */}
      <section className="warm-card p-5">
        <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          <Download className="w-4 h-4 text-primary/60" /> 数据导出
        </h3>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
          导出你的所有数据，包括个人资料、分身信息和对话记录。数据将以 JSON 格式下载。
        </p>
        <Button size="sm" variant="outline" className="rounded-xl border-border"
          onClick={() => exportData.mutate()}
          disabled={exportData.isPending}>
          <Download className="w-3.5 h-3.5 mr-1.5" />
          {exportData.isPending ? "导出中..." : "导出全部数据"}
        </Button>
      </section>

      {/* Danger Zone */}
      <section className="warm-card p-5 border-destructive/20">
        <h3 className="text-sm font-medium text-destructive mb-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> 危险操作
        </h3>
        <div className="p-4 bg-destructive/5 rounded-xl border border-destructive/10">
          <p className="text-sm text-foreground font-medium mb-1">删除账户</p>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            永久删除你的账户和所有相关数据，包括所有分身、对话记录和上传文件。此操作不可撤销。
          </p>
          <Button size="sm" variant="destructive" className="rounded-xl"
            onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> 删除账户
          </Button>
        </div>
      </section>

      {/* Delete Account Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-card border-border rounded-2xl max-w-sm">
          <DialogHeader><DialogTitle className="text-destructive">确认删除账户</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-destructive/5 rounded-xl border border-destructive/10">
              <p className="text-xs text-destructive leading-relaxed">
                此操作将永久删除你的账户及所有数据，包括 {accountStats?.totalPersonas || 0} 个分身、
                {accountStats?.totalMessages || 0} 条消息和 {accountStats?.totalFiles || 0} 个文件。
                此操作不可撤销。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">输入密码确认</Label>
              <Input value={deletePassword} onChange={e => setDeletePassword(e.target.value)}
                type="password" placeholder="输入你的登录密码"
                className="h-10 bg-muted/50 border-border rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/70">输入 "删除我的账户" 确认</Label>
              <Input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="删除我的账户"
                className="h-10 bg-muted/50 border-border rounded-xl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)} className="rounded-xl">取消</Button>
            <Button variant="destructive" className="rounded-xl"
              disabled={!deletePassword || deleteConfirmText !== "删除我的账户" || deleteAccount.isPending}
              onClick={() => deleteAccount.mutate({ confirmPassword: deletePassword })}>
              {deleteAccount.isPending ? "删除中..." : "永久删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── MAIN SETTINGS PAGE ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const [activeTab, setActiveTab] = useState<TabKey>("profile");

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")}
            className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">返回</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-title-group">
            <div className="app-nav-mark">
              <Leaf className="w-3.5 h-3.5" />
            </div>
            <div>
              <h1 className="app-nav-title">用户中心</h1>
              <p className="app-nav-subtitle">资料、AI 与数据管理</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-6 max-w-2xl mx-auto">
        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 p-1 bg-muted/30 rounded-xl overflow-x-auto scrollbar-hide">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex-shrink-0 ${
                  activeTab === tab.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}>
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "ai" && <AISettingsTab />}
        {activeTab === "wechat" && <WeChatTab />}
        {activeTab === "data" && <DataManagementTab />}
      </main>
    </div>
  );
}
