import { useState, useEffect, type ReactNode } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, ChevronDown, ChevronUp, Check,
  Mail, Calendar, Clock, Pencil,
  Eye, EyeOff, Plus, RefreshCw, Download, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import PageLoader from "@/components/PageLoader";

// ─── TAB CONFIG ──────────────────────────────────────────────────────────────

const TABS = [
  { key: "profile", label: "个人资料" },
  { key: "ai", label: "AI 设置" },
  { key: "wechat", label: "微信" },
  { key: "data", label: "数据管理" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// ─── SECTION HEADER · serif 标题 + muted 中文小注 ────────────────────────────

function SectionHeader({ note, title, action, danger }: {
  note: string; title: string; action?: ReactNode; danger?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h2 className={cn(
          "font-display text-lg sm:text-xl font-semibold",
          danger ? "text-destructive" : "text-foreground"
        )}>
          {title}
        </h2>
        <p className="kicker mt-1.5">{note}</p>
      </div>
      {action && <div className="flex-shrink-0 pt-1">{action}</div>}
    </div>
  );
}

// ─── STATUS CHIP · 语义色小标签 ──────────────────────────────────────────────

const CHIP_TONES = {
  primary: "border-primary/25 bg-primary/10 text-primary",
  success: "border-chart-4/30 bg-chart-4/10 text-chart-4",
  info: "border-chart-3/30 bg-chart-3/10 text-chart-3",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border/70 bg-muted/50 text-muted-foreground",
} as const;

type ChipTone = keyof typeof CHIP_TONES;

function StatusChip({ tone, children, className }: { tone: ChipTone; children: ReactNode; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
      CHIP_TONES[tone], className
    )}>
      {children}
    </span>
  );
}

// ─── SLIDER FIELD ────────────────────────────────────────────────────────────

function SliderField({ label, value, onChange, min, max, step, unit }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; unit?: string;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm text-foreground/80">{label}</Label>
        <span className="font-display text-sm font-semibold text-foreground">{value}{unit}</span>
      </div>
      <Slider value={[value]} onValueChange={v => onChange(v[0])} min={min} max={max} step={step} />
      <div className="flex justify-between text-[0.6875rem] text-muted-foreground">
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

// ─── PROVIDER CONFIG ROW ─────────────────────────────────────────────────────

function ProviderConfigRow({ provider, isDefault, onSave, onSetDefault }: {
  provider: { name: string; configured: boolean };
  isDefault: boolean;
  onSave: (data: { providerName: string; apiKey?: string; baseUrl?: string; model?: string }) => void;
  onSetDefault: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  return (
    <div className={cn(
      "surface overflow-hidden",
      isDefault && "border-cinnabar/40"
    )}>
      <div role="button" tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={e => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault(); setExpanded(!expanded);
          }
        }}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 p-3.5 hover:bg-muted/30 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-foreground font-medium truncate">{provider.name}</span>
          {isDefault && <StatusChip tone="primary">默认</StatusChip>}
          <StatusChip tone={provider.configured ? "success" : "muted"}>
            {provider.configured ? "已配置" : "未配置"}
          </StatusChip>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isDefault && (
            <button type="button" onClick={e => { e.stopPropagation(); onSetDefault(); }}
              className="text-xs text-primary hover:text-primary/80 px-1">设为默认</button>
          )}
          {expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>
      {expanded && (
        <div className="p-3.5 pt-3 space-y-3 border-t border-border">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">API Key</Label>
            <Input value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..." type="password" className="h-9 rounded-md text-sm" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Base URL</Label>
              <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1" className="h-9 rounded-md text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Model</Label>
              <Input value={model} onChange={e => setModel(e.target.value)}
                placeholder="gpt-4o" className="h-9 rounded-md text-sm" />
            </div>
          </div>
          <Button size="sm" className="rounded-md px-4"
            onClick={() => {
              onSave({ providerName: provider.name, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined, model: model || undefined });
              setExpanded(false);
            }}>
            <Check className="w-3.5 h-3.5" />保存
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── STAT ITEM · 大号衬线数字 + 中文小标签 ───────────────────────────────────

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-t border-border pt-3 pb-1">
      <div className="font-display text-xl font-semibold text-foreground leading-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
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

  if (!profile) return <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>;

  const memberDays = Math.max(1, Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86400000));

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-5">
      {/* Avatar + Basic Info */}
      <section className="surface p-6 sm:p-7">
        <SectionHeader note="昵称、邮箱与账户信息" title="个人资料" />
        <div className="flex items-start gap-5">
          <div className="w-20 h-20 rounded-lg bg-muted border border-border flex items-center justify-center flex-shrink-0">
            <span className="font-display text-3xl font-semibold text-foreground">{(profile.name || profile.username).charAt(0).toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">昵称</Label>
                  <Input value={editName} onChange={e => setEditName(e.target.value)}
                    className="h-9 rounded-md text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">邮箱</Label>
                  <Input value={editEmail} onChange={e => setEditEmail(e.target.value)}
                    type="email" placeholder="your@email.com"
                    className="h-9 rounded-md text-sm" />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="rounded-md px-5"
                    onClick={() => updateProfile.mutate({ name: editName.trim() || undefined, email: editEmail.trim() || undefined })}
                    disabled={updateProfile.isPending}>
                    {updateProfile.isPending ? "保存中..." : "保存"}
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-md" onClick={() => setEditing(false)}>取消</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="font-display text-xl font-semibold text-foreground">{profile.name || profile.username}</h3>
                  <StatusChip tone="primary">{profile.role}</StatusChip>
                </div>
                <p className="text-sm text-muted-foreground">@{profile.username}</p>
                {profile.email && (
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                    <Mail className="w-3 h-3" /> {profile.email}
                  </div>
                )}
                <div className="flex items-center gap-4 flex-wrap mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> 加入 {memberDays} 天
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> 上次登录 {new Date(profile.lastSignedIn).toLocaleDateString("zh-CN")}
                  </span>
                </div>
                <Button size="sm" variant="ghost" className="mt-3 -ml-2 text-xs text-primary hover:text-primary/80 rounded-md h-7 px-3"
                  onClick={() => setEditing(true)}>
                  <Pencil className="w-3 h-3" /> 编辑资料
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Account Stats */}
      {accountStats && (
        <section className="surface p-6 sm:p-7">
          <SectionHeader note="你的使用数据一览" title="账户统计" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-5">
            <StatItem label="数字分身" value={accountStats.totalPersonas} />
            <StatItem label="总对话次数" value={accountStats.totalChats} />
            <StatItem label="总消息数" value={accountStats.totalMessages} />
            <StatItem label="上传文件" value={accountStats.totalFiles} />
            <StatItem label="存储空间" value={formatBytes(accountStats.storageUsed)} />
            <StatItem label="使用天数" value={memberDays} />
          </div>
        </section>
      )}

      {/* Security */}
      <section className="surface p-6 sm:p-7">
        <SectionHeader note="密码与登录方式" title="安全设置" />
        <div>
          <div className="flex items-center justify-between gap-3 py-4 border-t border-border">
            <div className="min-w-0">
              <p className="text-sm text-foreground">登录密码</p>
              <p className="text-xs text-muted-foreground mt-0.5">定期修改密码以保护账户安全</p>
            </div>
            <Button size="sm" variant="outline" className="rounded-md text-xs flex-shrink-0 bg-transparent"
              onClick={() => setShowPasswordDialog(true)}>
              修改密码
            </Button>
          </div>
          {profile.loginMethod && (
            <div className="py-4 border-t border-border">
              <p className="text-sm text-foreground">登录方式</p>
              <p className="text-xs text-muted-foreground mt-0.5">{profile.loginMethod}</p>
            </div>
          )}
        </div>
      </section>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="bg-card border-border rounded-lg max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">修改密码</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/80">当前密码</Label>
              <div className="relative">
                <Input value={currentPwd} onChange={e => setCurrentPwd(e.target.value)}
                  type={showCurrentPwd ? "text" : "password"} placeholder="输入当前密码"
                  className="h-10 rounded-md pr-10" />
                <button type="button" onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                  aria-label={showCurrentPwd ? "隐藏密码" : "显示密码"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/80">新密码</Label>
              <div className="relative">
                <Input value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  type={showNewPwd ? "text" : "password"} placeholder="至少 6 位"
                  className="h-10 rounded-md pr-10" />
                <button type="button" onClick={() => setShowNewPwd(!showNewPwd)}
                  aria-label={showNewPwd ? "隐藏密码" : "显示密码"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {newPwd && newPwd.length < 6 && (
                <p className="text-xs text-destructive">密码至少需要 6 个字符</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/80">确认新密码</Label>
              <Input value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                type="password" placeholder="再次输入新密码"
                className="h-10 rounded-md" />
              {confirmPwd && confirmPwd !== newPwd && (
                <p className="text-xs text-destructive">两次输入的密码不一致</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPasswordDialog(false)} className="rounded-md">取消</Button>
            <Button className="rounded-md px-5"
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
    <div className="space-y-5">
      <section className="surface p-6 sm:p-7">
        <SectionHeader note="配置可用的模型服务" title="AI 提供商"
          action={defaultConfig.data && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              当前默认: <span className="text-foreground font-medium">{defaultConfig.data.providerName}</span>
            </span>
          )} />
        <div className="space-y-2.5">
          {providers.data?.map(p => (
            <ProviderConfigRow key={p.name} provider={p}
              isDefault={defaultConfig.data?.providerName === p.name}
              onSave={data => upsertConfig.mutate(data)}
              onSetDefault={() => setDefault.mutate({ providerName: p.name })} />
          ))}
        </div>
      </section>

      <section className="surface p-6 sm:p-7">
        <SectionHeader note="调整生成回复的参数" title="对话参数" />
        <div className="space-y-6">
          <SliderField label="Temperature（创造性）" value={temperature} onChange={setTemperature}
            min={0} max={2} step={0.1} />
          <SliderField label="Max Tokens（最大回复长度）" value={maxTokens} onChange={setMaxTokens}
            min={256} max={8192} step={256} />
          <SliderField label="上下文消息数" value={contextLimit} onChange={setContextLimit}
            min={5} max={50} step={5} unit=" 条" />
          <Button size="sm" className="rounded-md px-5"
            onClick={() => updateExtra.mutate({ extraConfig: { temperature, maxTokens, contextLimit } })}
            disabled={updateExtra.isPending}>
            {updateExtra.isPending ? "保存中..." : "保存参数"}
          </Button>
        </div>
      </section>
    </div>
  );
}

// ─── WECHAT TAB ──────────────────────────────────────────────────────────────

function WeChatTab() {
  const wechatStatus = trpc.wechat.getStatus.useQuery(undefined, { refetchInterval: 3000 });
  const startLogin = trpc.wechat.startLogin.useMutation({
    onSuccess: () => { toast.success("请使用微信扫描二维码"); wechatStatus.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const submitCode = trpc.wechat.submitVerifyCode.useMutation({
    onSuccess: () => { wechatStatus.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const cancelLogin = trpc.wechat.cancelLogin.useMutation({
    onSuccess: () => { wechatStatus.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const stopBot = trpc.wechat.stop.useMutation({
    onSuccess: () => { toast.success("已断开微信连接"); wechatStatus.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const bot = wechatStatus.data;
  const [verifyCode, setVerifyCode] = useState("");

  const isConnected = bot?.status === "logged_in";
  const isScanning = bot?.status === "scanning";
  const isScanned = bot?.status === "scaned";
  const needsCode = bot?.status === "need_verifycode";
  const isPending = isScanning || isScanned || needsCode;

  const statusChip =
    isConnected ? <StatusChip tone="success">已连接</StatusChip> :
    isScanned ? <StatusChip tone="info">已扫码</StatusChip> :
    isScanning ? <StatusChip tone="info">等待扫码</StatusChip> :
    needsCode ? <StatusChip tone="info">等待验证码</StatusChip> :
    bot?.status === "error" ? <StatusChip tone="error">出错</StatusChip> :
    <StatusChip tone="muted">未连接</StatusChip>;

  return (
    <div className="space-y-5">
      <section className="surface p-6 sm:p-7">
        <SectionHeader note="通过微信官方 ClawBot 通道连接" title="微信连接"
          action={statusChip} />

        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <div className="flex items-center gap-3 mb-2.5">
            <span className={cn(
              "seal-dot flex-shrink-0",
              isConnected ? "!bg-chart-4" :
              isPending ? "!bg-chart-3 animate-pulse-soft" :
              bot?.status === "error" ? "!bg-destructive" : "!bg-muted-foreground/30"
            )} />
            <span className="text-sm text-foreground font-medium">
              {isConnected ? "已连接，微信消息会转交给分身" :
               isScanned ? "已扫码，请在手机上确认授权" :
               isScanning ? "等待扫码" :
               needsCode ? "请输入微信上显示的数字" :
               bot?.status === "error" ? "连接出错" : "未连接"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            使用微信官方「ClawBot」插件接入，全程不涉及第三方协议，不存在封号风险。
            需要微信 8.0.70 或更高版本，并且「我 → 设置 → 插件」中能看到「微信 ClawBot」入口。
          </p>
        </div>

        {bot?.qrCodeUrl && isPending && (
          <div className="mt-5 flex flex-col items-center gap-3 py-6 px-4 rounded-lg border border-border bg-card">
            <div className="bg-white p-3 rounded-lg border border-border">
              <img src={bot.qrCodeUrl} alt="WeChat QR" className="w-44 h-44" />
            </div>
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              {needsCode ? "已扫码，请输入手机上显示的数字以继续"
                : isScanned ? "已扫码，请在手机上确认授权"
                : "请使用微信扫描二维码，并在手机上确认授权"}
            </p>
          </div>
        )}

        {needsCode && (
          <div className="mt-4 p-4 rounded-lg border border-border space-y-3">
            <Label className="text-xs text-muted-foreground">微信上显示的数字</Label>
            <div className="flex gap-2">
              <Input
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="例如 123456"
                className="h-9 rounded-md text-sm"
                inputMode="numeric"
              />
              <Button size="sm" className="rounded-md px-5 flex-shrink-0"
                disabled={!verifyCode.trim() || submitCode.isPending}
                onClick={() => submitCode.mutate({ code: verifyCode.trim() })}>
                {submitCode.isPending ? "提交中..." : "确认"}
              </Button>
            </div>
          </div>
        )}

        {bot?.lastError && (
          <p className="mt-4 text-xs text-destructive leading-relaxed">{bot.lastError}</p>
        )}

        <div className="flex gap-2 mt-5">
          <Button size="sm" className="rounded-md px-5"
            onClick={() => startLogin.mutate()}
            disabled={isConnected || isPending || startLogin.isPending}>
            {startLogin.isPending ? "请求中..." : isConnected ? "已连接" : "连接微信"}
          </Button>
          {isConnected ? (
            <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent"
              onClick={() => stopBot.mutate()} disabled={stopBot.isPending}>
              {stopBot.isPending ? "断开中..." : "断开连接"}
            </Button>
          ) : isPending ? (
            <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent"
              onClick={() => cancelLogin.mutate()} disabled={cancelLogin.isPending}>
              取消
            </Button>
          ) : null}
        </div>
      </section>

      <WeChatBindingsSection connected={isConnected} />
      <WeChatCommandsSection />
    </div>
  );
}

// ─── WECHAT DEFAULT PERSONA BINDINGS ────────────────────────────────────────

function WeChatBindingsSection({ connected }: { connected: boolean }) {
  const bindings = trpc.wechat.listBindings.useQuery();
  const personas = trpc.persona.list.useQuery();

  const setDefault = trpc.wechat.setDefaultPersona.useMutation({
    onSuccess: () => {
      toast.success("已设为默认分身");
      bindings.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const unbind = trpc.wechat.unbind.useMutation({
    onSuccess: () => {
      toast.success("已解除绑定");
      bindings.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [selectedPersonaId, setSelectedPersonaId] = useState("");
  const [unbindTarget, setUnbindTarget] = useState<{ id: number; label: string } | null>(null);

  const personaNameById = new Map((personas.data ?? []).map(p => [p.id, p.name]));
  const readyPersonas = (personas.data ?? []).filter(p => p.analysisStatus === "ready");
  const bindingsData = bindings.data ?? [];

  // The ClawBot conversation is always with the account owner, so a single
  // binding (the default persona) is the norm.
  const primaryBinding = bindingsData[0];

  function handleSetDefault() {
    const personaId = Number(selectedPersonaId);
    if (!personaId || !primaryBinding) return;
    setDefault.mutate({
      wechatUserId: primaryBinding.wechatUserId,
      personaId,
      wechatName: primaryBinding.wechatName ?? undefined,
    });
  }

  return (
    <section className="surface p-6 sm:p-7">
      <SectionHeader note="选择在微信里默认对话的分身" title="默认分身"
        action={bindingsData.length > 0 && (
          <StatusChip tone="muted">{bindingsData.length} 个绑定</StatusChip>
        )} />

      {bindings.isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">加载中...</div>
      ) : primaryBinding ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 py-3.5 border-b border-border">
            <div className="min-w-0">
              <p className="text-sm text-foreground font-medium truncate">
                {primaryBinding.wechatName || "我的微信"}
              </p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                当前由「{personaNameById.get(primaryBinding.personaId) ?? `#${primaryBinding.personaId}`}」回复
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <StatusChip tone="success">生效中</StatusChip>
              <button onClick={() => setUnbindTarget({
                id: primaryBinding.id,
                label: primaryBinding.wechatName || "我的微信",
              })}
                title="解除绑定"
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">改为默认回复的分身</Label>
            <div className="flex gap-2">
              <Select value={selectedPersonaId} onValueChange={setSelectedPersonaId}>
                <SelectTrigger className="h-9 rounded-md text-sm w-full">
                  <SelectValue placeholder="选择分身" />
                </SelectTrigger>
                <SelectContent>
                  {readyPersonas.map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="rounded-md px-4 flex-shrink-0"
                disabled={!selectedPersonaId || setDefault.isPending || readyPersonas.length === 0}
                onClick={handleSetDefault}>
                {setDefault.isPending ? "保存中..." : "保存"}
              </Button>
            </div>
            {readyPersonas.length === 0 && (
              <p className="text-[0.6875rem] text-muted-foreground leading-relaxed">
                暂无已完成性格分析的分身，请先创建并完成分身分析。
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {connected
              ? "还没有设置默认分身。连接成功后回到这里，选择一个分身作为微信里的默认对话对象。"
              : "请先在上方连接微信，连接成功后即可选择默认分身。"}
          </p>
        </div>
      )}

      {/* 解除绑定确认 */}
      <Dialog open={!!unbindTarget} onOpenChange={open => !open && setUnbindTarget(null)}>
        <DialogContent className="bg-card border-border rounded-lg max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">解除绑定</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2 leading-relaxed">
            解除后，微信消息将不再转交给任何分身。可以随时重新设置。
          </p>
          <DialogFooter>
            <Button variant="ghost" className="rounded-md" onClick={() => setUnbindTarget(null)}>取消</Button>
            <Button variant="destructive" className="rounded-md px-5"
              disabled={unbind.isPending}
              onClick={() => unbindTarget && unbind.mutate({ id: unbindTarget.id })}>
              {unbind.isPending ? "解除中..." : "确认解除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─── WECHAT COMMANDS HELP ───────────────────────────────────────────────────

function WeChatCommandsSection() {
  const commands = [
    { cmd: "/使用 <分身名>", desc: "切换当前对话的分身" },
    { cmd: "/分身列表", desc: "查看所有可用分身" },
    { cmd: "/当前分身", desc: "查看正在对话的分身" },
    { cmd: "/毕业", desc: "生成告别信并完成毕业" },
  ];

  return (
    <section className="surface p-6 sm:p-7">
      <SectionHeader note="在微信里直接发送" title="指令" />
      <div className="space-y-2.5">
        {commands.map(c => (
          <div key={c.cmd} className="flex items-baseline gap-3">
            <code className="text-xs font-mono text-foreground bg-muted/50 px-2 py-1 rounded flex-shrink-0">
              {c.cmd}
            </code>
            <span className="text-xs text-muted-foreground">{c.desc}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[0.6875rem] text-muted-foreground leading-relaxed">
        指令不会消耗模型调用。切换只在当前会话内生效，重启后回到默认分身。
      </p>
    </section>
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
      a.download = `mirrai-export-${new Date().toISOString().slice(0, 10)}.json`;
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
    <div className="space-y-5">
      {/* Storage Overview */}
      {accountStats && (
        <section className="surface p-6 sm:p-7">
          <SectionHeader note="存储空间使用情况" title="存储概览" />
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">已用空间</span>
              <span className="font-medium text-foreground">{formatBytes(accountStats.storageUsed)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="progress-bar h-full"
                style={{ width: `${Math.min(100, (accountStats.storageUsed / (100 * 1048576)) * 100)}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-4 mt-3">
              <div className="border-t border-border pt-3">
                <div className="font-display text-xl font-semibold text-foreground">{accountStats.totalPersonas}</div>
                <div className="text-xs text-muted-foreground mt-0.5">分身</div>
              </div>
              <div className="border-t border-border pt-3">
                <div className="font-display text-xl font-semibold text-foreground">{accountStats.totalMessages}</div>
                <div className="text-xs text-muted-foreground mt-0.5">消息</div>
              </div>
              <div className="border-t border-border pt-3">
                <div className="font-display text-xl font-semibold text-foreground">{accountStats.totalFiles}</div>
                <div className="text-xs text-muted-foreground mt-0.5">文件</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Export */}
      <section className="surface p-6 sm:p-7">
        <SectionHeader note="下载你的全部数据" title="数据导出" />
        <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
          导出你的所有数据，包括个人资料、分身信息和对话记录。数据将以 JSON 格式下载。
        </p>
        <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent"
          onClick={() => exportData.mutate()}
          disabled={exportData.isPending}>
          <Download className="w-3.5 h-3.5" />
          {exportData.isPending ? "导出中..." : "导出全部数据"}
        </Button>
      </section>

      {/* Danger Zone */}
      <section className="rounded-lg border border-destructive/30 bg-card p-6 sm:p-7">
        <SectionHeader note="不可撤销的操作" title="危险操作" danger />
        <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/15">
          <p className="text-sm text-foreground font-medium mb-1">删除账户</p>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            永久删除你的账户和所有相关数据，包括所有分身、对话记录和上传文件。此操作不可撤销。
          </p>
          <Button size="sm" variant="destructive" className="rounded-md px-5"
            onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="w-3.5 h-3.5" /> 删除账户
          </Button>
        </div>
      </section>

      {/* Delete Account Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-card border-border rounded-lg max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-destructive">确认删除账户</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/15">
              <p className="text-xs text-destructive leading-relaxed">
                此操作将永久删除你的账户及所有数据，包括 {accountStats?.totalPersonas || 0} 个分身、
                {accountStats?.totalMessages || 0} 条消息和 {accountStats?.totalFiles || 0} 个文件。
                此操作不可撤销。
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/80">输入密码确认</Label>
              <Input value={deletePassword} onChange={e => setDeletePassword(e.target.value)}
                type="password" placeholder="输入你的登录密码"
                className="h-10 rounded-md" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/80">输入 "删除我的账户" 确认</Label>
              <Input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="删除我的账户"
                className="h-10 rounded-md" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)} className="rounded-md">取消</Button>
            <Button variant="destructive" className="rounded-md px-5"
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

  if (!user) return <PageLoader />;

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
            <div>
              <h1 className="app-nav-title">设置</h1>
              <p className="app-nav-subtitle">账户与偏好</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container page-main max-w-2xl">
        <div className="mb-8">
          <p className="kicker kicker-accent mb-3">书房</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-foreground">设置</h1>
          <p className="text-sm text-muted-foreground mt-2.5 leading-relaxed">
            账户、模型与微信——把工具放在顺手的位置。
          </p>
        </div>

        {/* Tab Navigation · 发丝线下划线页签 */}
        <div className="flex gap-1 mb-7 border-b border-border overflow-x-auto scrollbar-hide">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-3 sm:px-4 py-2.5 -mb-px text-sm border-b-2 transition-colors flex-shrink-0",
                activeTab === tab.key
                  ? "border-cinnabar text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <motion.div key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}>
          {activeTab === "profile" && <ProfileTab />}
          {activeTab === "ai" && <AISettingsTab />}
          {activeTab === "wechat" && <WeChatTab />}
          {activeTab === "data" && <DataManagementTab />}
        </motion.div>
      </main>
    </div>
  );
}
