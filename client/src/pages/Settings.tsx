import { useState, useEffect, useRef, type ReactNode, type ChangeEvent } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  MonitorDown, Plug, Unplug, Upload, FileJson, Package,
} from "lucide-react";
import { toast } from "sonner";
import { isInstallAvailable, onInstallAvailabilityChange, promptInstall } from "@/lib/pwa";
import PageLoader from "@/components/PageLoader";
import GraduationModeSelect, {
  graduationModeNoteKey,
} from "@/components/GraduationModeSelect";
import DistillationModePicker from "@/components/DistillationModePicker";
import { useLocale } from "@/contexts/LocaleContext";
import SafetyTransparency from "@/components/SafetyTransparency";
import type { GraduationMode } from "@shared/graduation-mode";
import {
  DEFAULT_DISTILLATION_MODE,
  type DistillationMode,
} from "@shared/distillation-modes";

// ─── TAB CONFIG ──────────────────────────────────────────────────────────────

const TABS = [
  { key: "profile", labelKey: "settings.tabs.profile" },
  { key: "ai", labelKey: "settings.tabs.aiSettings" },
  { key: "wechat", labelKey: "settings.tabs.wechat" },
  { key: "channels", labelKey: "settings.tabs.channels" },
  { key: "sources", labelKey: "settings.tabs.sources" },
  { key: "templates", labelKey: "settings.tabs.templates" },
  { key: "data", labelKey: "settings.tabs.data" },
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
  // The id that ties the label to the slider.
  const id = `slider-${label.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm text-foreground/80" htmlFor={id}>{label}</Label>
        <span className="stat-value text-sm">{value}{unit}</span>
      </div>
      {/* The slider has no name of its own: it was announced as
          "slider" with nothing to say what it set. */}
      <Slider id={id} aria-label={label} aria-valuetext={`${value}${unit ?? ""}`}
        value={[value]} onValueChange={v => onChange(v[0])} min={min} max={max} step={step} />
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
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  return (
    <div className={cn(
      "surface overflow-hidden",
      isDefault && "border-cinnabar/40"
    )}>
      {/**
       * The header is a real button.
       *
       * It was a `div` with `role="button"` that contained a real
       * button — the "make this the default" action. Nested
       * interactive controls confuse assistive technology: the row
       * announced as a button that contains a button.
       *
       * The two actions are now siblings.
       */}
      <div className="w-full flex items-center justify-between gap-3 p-3.5 hover:bg-muted/30 transition-colors">
        <button type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={`provider-panel-${provider.name}`}
          className="flex items-center gap-2 min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded">
          <span className="text-sm text-foreground font-medium truncate">{provider.name}</span>
          {isDefault && <StatusChip tone="primary">{t("settings.ai.default")}</StatusChip>}
          <StatusChip tone={provider.configured ? "success" : "muted"}>
            {provider.configured ? t("settings.ai.hasKey") : t("settings.ai.noKey")}
          </StatusChip>
        </button>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isDefault && (
            <button type="button" onClick={onSetDefault}
              className="text-xs text-primary hover:text-primary/80 px-1">{t("settings.ai.setDefault")}</button>
          )}
          <button type="button" onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls={`provider-panel-${provider.name}`}
            aria-label={expanded ? t("common.close") : t("settings.ai.expand")}
            className="text-muted-foreground hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded">
            {expanded
              ? <ChevronUp className="w-4 h-4" />
              : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="p-3.5 pt-3 space-y-3 border-t border-border">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor={`provider-${provider.name}-api-key`}>{t("settings.ai.apiKey")}</Label>
            <Input id={`provider-${provider.name}-api-key`} value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..." type="password" className="h-9 rounded-md text-sm" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground" htmlFor={`provider-${provider.name}-base-url`}>{t("settings.ai.baseUrl")}</Label>
              <Input id={`provider-${provider.name}-base-url`} value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1" className="h-9 rounded-md text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground" htmlFor={`provider-${provider.name}-model`}>{t("settings.ai.model")}</Label>
              <Input id={`provider-${provider.name}-model`} value={model} onChange={e => setModel(e.target.value)}
                placeholder="gpt-4o" className="h-9 rounded-md text-sm" />
            </div>
          </div>
          <Button size="sm" className="rounded-md px-4"
            onClick={() => {
              onSave({ providerName: provider.name, apiKey: apiKey || undefined, baseUrl: baseUrl || undefined, model: model || undefined });
              setExpanded(false);
            }}>
            <Check className="w-3.5 h-3.5" />{t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── STAT ITEM · 大号衬线数字 + 中文小标签 ───────────────────────────────────

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-block">
      <div className="stat-value">{value}</div>
      <div className="stat-label mt-1">{label}</div>
    </div>
  );
}

// ─── PROFILE TAB ─────────────────────────────────────────────────────────────

function ProfileTab() {
  const { t, locale } = useLocale();
  const { data: profile, refetch } = trpc.user.getProfile.useQuery();
  const { data: accountStats } = trpc.user.getAccountStats.useQuery();
  const updateProfile = trpc.user.updateProfile.useMutation({
    onSuccess: () => { toast.success(t("settings.profile.updated")); refetch(); setEditing(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const changePassword = trpc.user.changePassword.useMutation({
    onSuccess: () => { toast.success(t("settings.profile.passwordChanged")); setShowPasswordDialog(false); setCurrentPwd(""); setNewPwd(""); setConfirmPwd(""); },
    onError: (e: any) => toast.error(e.message),
  });
  /* The instance-wide default for the graduation mechanism. A persona may
     override it, so this is the value the ones that do not override it
     follow. */
  const updateGraduationMode = trpc.user.updateGraduationMode.useMutation({
    onSuccess: () => { toast.success(t("graduationMode.saved")); refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  /* Whether the app may read the user's own messages. */
  const updateTrajectoryAssessment = trpc.user.updateTrajectoryAssessment.useMutation({
    onSuccess: () => refetch(),
    onError: (e: any) => toast.error(e.message),
  });
  /* Who the user is, as far as the persona is concerned. */
  const [addressStyle, setAddressStyle] = useState("");
  const [boundaries, setBoundaries] = useState("");
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
      setAddressStyle(profile.addressStyle || "");
      setBoundaries(profile.boundaries || "");
    }
  }, [profile]);

  if (!profile) return <div className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>;

  const memberDays = Math.max(1, Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86400000));

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return (
    <div className="space-y-5">
      {/* Avatar + Basic Info */}
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.profile.accountNote")} title={t("settings.profile.accountTitle")} />
        <div className="flex items-start gap-5">
          <div className="w-20 h-20 rounded-lg bg-muted border border-border flex items-center justify-center flex-shrink-0">
            <span className="font-sans text-3xl font-semibold text-foreground">{(profile.name || profile.username).charAt(0).toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground" htmlFor="profile-name">{t("settings.profile.name")}</Label>
                  <Input id="profile-name" value={editName} onChange={e => setEditName(e.target.value)}
                    className="h-9 rounded-md text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground" htmlFor="profile-email">{t("settings.profile.email")}</Label>
                  <Input id="profile-email" value={editEmail} onChange={e => setEditEmail(e.target.value)}
                    type="email" placeholder="your@email.com"
                    className="h-9 rounded-md text-sm" />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="rounded-md px-5"
                    onClick={() => updateProfile.mutate({
                      name: editName.trim() || undefined,
                      // `undefined` means "leave it alone", so an empty
                      // field could never clear the address. `null`
                      // means "take it away".
                      email: editEmail.trim() || null,
                    })}
                    disabled={updateProfile.isPending}>
                    {updateProfile.isPending ? t("common.saving") : t("common.save")}
                  </Button>
                  <Button size="sm" variant="ghost" className="rounded-md" onClick={() => setEditing(false)}>{t("common.cancel")}</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="font-sans text-lg font-semibold text-foreground">{profile.name || profile.username}</h3>
                  {profile.role !== "user" && (
                    <StatusChip tone="primary">{t(`settings.profile.roles.${profile.role}` as any)}</StatusChip>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">@{profile.username}</p>
                {profile.email && (
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground">
                    <Mail className="w-3 h-3" /> {profile.email}
                  </div>
                )}
                <div className="flex items-center gap-4 flex-wrap mt-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> {t("settings.profile.joined", { count: memberDays })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {t("settings.profile.lastLogin", { date: new Date(profile.lastSignedIn).toLocaleDateString(locale) })}
                  </span>
                </div>
                <Button size="sm" variant="ghost" className="mt-3 -ml-2 text-xs text-primary hover:text-primary/80 rounded-md h-7 px-3"
                  onClick={() => setEditing(true)}>
                  <Pencil className="w-3 h-3" /> {t("settings.profile.edit")}
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Account Stats */}
      {accountStats && (
        <section className="surface p-5 sm:p-6">
          <SectionHeader note={t("settings.profile.statsNote")} title={t("settings.profile.statsTitle")} />
          <div className="stat-grid grid-cols-2 sm:grid-cols-3">
            <StatItem label={t("settings.profile.statPersonas")} value={accountStats.totalPersonas} />
            <StatItem label={t("settings.profile.statChats")} value={accountStats.totalChats} />
            <StatItem label={t("settings.profile.statMessages")} value={accountStats.totalMessages} />
            <StatItem label={t("settings.profile.statFiles")} value={accountStats.totalFiles} />
            <StatItem label={t("settings.profile.statStorage")} value={formatBytes(accountStats.storageUsed)} />
            <StatItem label={t("settings.profile.statDays")} value={memberDays} />
          </div>
        </section>
      )}

      {/* Graduation mode — the instance-wide default */}
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("graduationMode.globalNote")} title={t("graduationMode.globalTitle")} />
        <div className="space-y-2.5">
          <GraduationModeSelect
            id="graduation-mode"
            ariaLabel={t("graduationMode.globalTitle")}
            value={(profile.graduationMode as GraduationMode) ?? "suggest"}
            onChange={mode => updateGraduationMode.mutate({ mode: mode as GraduationMode })}
            disabled={updateGraduationMode.isPending}
          />
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t(graduationModeNoteKey((profile.graduationMode as GraduationMode) ?? "suggest") as any)}
          </p>
        </div>
      </section>

      {/* Who the user is. The persona is a portrait of the other person;
          it knew nothing about the one in front of it. */}
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("userProfile.note")} title={t("userProfile.title")} />
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="user-address-style">{t("userProfile.addressStyle")}</Label>
            <Input
              id="user-address-style"
              value={addressStyle}
              onChange={e => setAddressStyle(e.target.value)}
              placeholder={t("userProfile.addressStylePlaceholder")}
              maxLength={64}
              className="h-9 rounded-md text-sm"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("userProfile.addressStyleNote")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="user-boundaries">{t("userProfile.boundaries")}</Label>
            <textarea
              id="user-boundaries"
              value={boundaries}
              onChange={e => setBoundaries(e.target.value)}
              placeholder={t("userProfile.boundariesPlaceholder")}
              maxLength={500}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50 resize-y"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("userProfile.boundariesNote")}
            </p>
          </div>
          <Button
            size="sm"
            className="rounded-md px-5"
            disabled={updateProfile.isPending}
            onClick={() => updateProfile.mutate({
              addressStyle: addressStyle.trim() || null,
              boundaries: boundaries.trim() || null,
            })}
          >
            {updateProfile.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </section>

      {/* What the safety layer noticed. It was recorded and then hidden. */}
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("safetyPanel.note")} title={t("safetyPanel.title")} />
        <SafetyTransparency />
      </section>

      {/* The local-first promise, made concrete. */}
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("localFirst.note")} title={t("localFirst.title")} />
        <div className="space-y-4">
          <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
            <p className="text-xs font-medium text-foreground/80 mb-1.5">
              {t("consent.settingTitle")}
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("consent.settingBody")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="trajectory-assessment">{t("localFirst.trajectoryTitle")}</Label>
            <select
              id="trajectory-assessment"
              value={(profile.trajectoryAssessment as "auto" | "on" | "off") ?? "auto"}
              onChange={(e) => updateTrajectoryAssessment.mutate({ setting: e.target.value as any })}
              disabled={updateTrajectoryAssessment.isPending}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            >
              <option value="auto">{t("localFirst.trajectoryAuto")}</option>
              <option value="on">{t("localFirst.trajectoryOn")}</option>
              <option value="off">{t("localFirst.trajectoryOff")}</option>
            </select>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("localFirst.trajectoryNote")}
            </p>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.profile.securityNote")} title={t("settings.profile.securityTitle")} />
        <div>
          <div className="flex items-center justify-between gap-3 py-4 border-t border-border">
            <div className="min-w-0">
              <p className="text-sm text-foreground">{t("settings.profile.loginPassword")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("settings.profile.passwordHint")}</p>
            </div>
            <Button size="sm" variant="outline" className="rounded-md text-xs flex-shrink-0 bg-transparent"
              onClick={() => setShowPasswordDialog(true)}>
              {t("settings.profile.changePassword")}
            </Button>
          </div>
          {profile.loginMethod && (
            <div className="py-4 border-t border-border">
              <p className="text-sm text-foreground">{t("settings.profile.loginMethod")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{profile.loginMethod}</p>
            </div>
          )}
        </div>
      </section>

      {/* Change Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent className="bg-card border-border rounded-lg max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{t("settings.profile.changePassword")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/80" htmlFor="current-password">{t("settings.profile.currentPassword")}</Label>
              <div className="relative">
                <Input id="current-password" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)}
                  type={showCurrentPwd ? "text" : "password"} placeholder={t("settings.profile.currentPasswordPlaceholder")}
                  className="h-10 rounded-md pr-10" />
                <button type="button" onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                  aria-label={showCurrentPwd ? t("settings.profile.hidePassword") : t("settings.profile.showPassword")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showCurrentPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/80" htmlFor="new-password">{t("settings.profile.newPassword")}</Label>
              <div className="relative">
                <Input id="new-password" value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  type={showNewPwd ? "text" : "password"} placeholder={t("settings.profile.newPasswordPlaceholder")}
                  className="h-10 rounded-md pr-10" />
                <button type="button" onClick={() => setShowNewPwd(!showNewPwd)}
                  aria-label={showNewPwd ? t("settings.profile.hidePassword") : t("settings.profile.showPassword")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showNewPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {newPwd && newPwd.length < 6 && (
                <p className="text-xs text-destructive">{t("settings.profile.passwordTooShort")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/80" htmlFor="confirm-password">{t("settings.profile.confirmPassword")}</Label>
              <Input id="confirm-password" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                type="password" placeholder={t("settings.profile.confirmPasswordPlaceholder")}
                className="h-10 rounded-md" />
              {confirmPwd && confirmPwd !== newPwd && (
                <p className="text-xs text-destructive">{t("settings.profile.passwordMismatch")}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPasswordDialog(false)} className="rounded-md">{t("common.cancel")}</Button>
            <Button className="rounded-md px-5"
              disabled={!currentPwd || newPwd.length < 6 || newPwd !== confirmPwd || changePassword.isPending}
              onClick={() => changePassword.mutate({ currentPassword: currentPwd, newPassword: newPwd })}>
              {changePassword.isPending ? t("settings.profile.changing") : t("settings.profile.confirmChange")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── AI SETTINGS TAB ─────────────────────────────────────────────────────────

function AISettingsTab() {
  const { t } = useLocale();
  const providers = trpc.llmConfig.listProviders.useQuery();
  const defaultConfig = trpc.llmConfig.getDefault.useQuery();
  const upsertConfig = trpc.llmConfig.upsert.useMutation({
    onSuccess: () => { toast.success(t("settings.ai.configSaved")); providers.refetch(); },
  });
  const setDefault = trpc.llmConfig.setDefault.useMutation({
    onSuccess: () => { toast.success(t("settings.ai.defaultUpdated")); defaultConfig.refetch(); },
  });
  const updateExtra = trpc.llmConfig.updateExtraConfig.useMutation({
    onSuccess: () => { toast.success(t("settings.ai.paramsSaved")); defaultConfig.refetch(); },
  });

  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [contextLimit, setContextLimit] = useState(20);
  // How many memories go into a turn. It was hardcoded, so a person
  // whose persona needed to remember more had no way to say so.
  const [retrievalK, setRetrievalK] = useState(5);

  useEffect(() => {
    if (defaultConfig.data?.extraConfig) {
      const e = defaultConfig.data.extraConfig as any;
      if (e.temperature != null) setTemperature(e.temperature);
      if (e.maxTokens != null) setMaxTokens(e.maxTokens);
      if (e.contextLimit != null) setContextLimit(e.contextLimit);
      if (e.retrievalK != null) setRetrievalK(e.retrievalK);
    }
  }, [defaultConfig.data]);

  return (
    <div className="space-y-5">
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.ai.note")} title={t("settings.ai.title")}
          action={defaultConfig.data && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {t("settings.ai.currentDefaultLead")} <span className="text-foreground font-medium">{defaultConfig.data.providerName}</span>
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

      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.ai.paramsNote")} title={t("settings.ai.paramsTitle")} />
        <div className="space-y-6">
          <SliderField label={t("settings.ai.temperatureLabel")} value={temperature} onChange={setTemperature}
            min={0} max={2} step={0.1} />
          <SliderField label={t("settings.ai.maxTokensLabel")} value={maxTokens} onChange={setMaxTokens}
            min={256} max={8192} step={256} />
          <SliderField label={t("settings.ai.contextLabel")} value={contextLimit} onChange={setContextLimit}
            min={5} max={50} step={5} unit={t("settings.ai.contextUnit")} />
          <SliderField label={t("settings.ai.retrievalKLabel")} value={retrievalK} onChange={setRetrievalK}
            min={1} max={20} step={1} unit={t("settings.ai.retrievalKUnit")} />
          <p className="text-xs text-muted-foreground leading-relaxed -mt-3">
            {t("settings.ai.retrievalKNote")}
          </p>
          <Button size="sm" className="rounded-md px-5"
            onClick={() => updateExtra.mutate({ extraConfig: { temperature, maxTokens, contextLimit, retrievalK } })}
            disabled={updateExtra.isPending}>
            {updateExtra.isPending ? t("common.saving") : t("settings.ai.saveParams")}
          </Button>
        </div>
      </section>
    </div>
  );
}

// ─── WECHAT TAB ──────────────────────────────────────────────────────────────

function WeChatTab() {
  const { t } = useLocale();
  const wechatStatus = trpc.wechat.getStatus.useQuery(undefined, { refetchInterval: 3000 });
  const startLogin = trpc.wechat.startLogin.useMutation({
    onSuccess: () => { toast.success(t("settings.wechat.scan")); wechatStatus.refetch(); },
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
    onSuccess: () => { toast.success(t("settings.wechat.disconnected")); wechatStatus.refetch(); },
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
    isConnected ? <StatusChip tone="success">{t("settings.wechat.connected")}</StatusChip> :
    isScanned ? <StatusChip tone="info">{t("settings.wechat.scanned")}</StatusChip> :
    isScanning ? <StatusChip tone="info">{t("settings.wechat.waitingScan")}</StatusChip> :
    needsCode ? <StatusChip tone="info">{t("settings.wechat.waitingCode")}</StatusChip> :
    bot?.status === "error" ? <StatusChip tone="error">{t("settings.wechat.error")}</StatusChip> :
    <StatusChip tone="muted">{t("settings.wechat.notConnected")}</StatusChip>;

  return (
    <div className="space-y-5">
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.wechat.note")} title={t("settings.wechat.title")}
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
              {isConnected ? t("settings.wechat.connectedHint") :
               isScanned ? t("settings.wechat.scannedHint") :
               isScanning ? t("settings.wechat.waitingScan") :
               needsCode ? t("settings.wechat.codeHint") :
               bot?.status === "error" ? t("settings.wechat.errorHint") : t("settings.wechat.notConnected")}
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("settings.wechat.description")}
          </p>
        </div>

        {bot?.qrCodeUrl && isPending && (
          <div className="mt-5 flex flex-col items-center gap-3 py-6 px-4 rounded-lg border border-border bg-card">
            <div className="bg-white p-3 rounded-lg border border-border">
              <img src={bot.qrCodeUrl} alt={t("settings.wechat.qrAlt")} className="w-44 h-44" />
            </div>
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              {needsCode ? t("settings.wechat.codeScanned")
                : isScanned ? t("settings.wechat.scannedHint")
                : t("settings.wechat.codePrompt")}
            </p>
          </div>
        )}

        {needsCode && (
          <div className="mt-4 p-4 rounded-lg border border-border space-y-3">
            <Label className="text-xs text-muted-foreground" htmlFor="wechat-verify-code">{t("settings.wechat.codeLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="wechat-verify-code"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder={t("settings.wechat.codePlaceholder")}
                className="h-9 rounded-md text-sm"
                inputMode="numeric"
              />
              <Button size="sm" className="rounded-md px-5 flex-shrink-0"
                disabled={!verifyCode.trim() || submitCode.isPending}
                onClick={() => submitCode.mutate({ code: verifyCode.trim() })}>
                {submitCode.isPending ? t("settings.wechat.submitting") : t("settings.wechat.submit")}
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
            {startLogin.isPending ? t("settings.wechat.requesting") : isConnected ? t("settings.wechat.connected") : t("settings.wechat.connect")}
          </Button>
          {isConnected ? (
            <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent"
              onClick={() => stopBot.mutate()} disabled={stopBot.isPending}>
              {stopBot.isPending ? t("settings.wechat.disconnecting") : t("settings.wechat.disconnect")}
            </Button>
          ) : isPending ? (
            <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent"
              onClick={() => cancelLogin.mutate()} disabled={cancelLogin.isPending}>
              {t("common.cancel")}
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
  const { t } = useLocale();
  const bindings = trpc.wechat.listBindings.useQuery();
  const personas = trpc.persona.list.useQuery();

  const setDefault = trpc.wechat.setDefaultPersona.useMutation({
    onSuccess: () => {
      toast.success(t("settings.wechat.setDefaultPersona"));
      bindings.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const unbind = trpc.wechat.unbind.useMutation({
    onSuccess: () => {
      toast.success(t("settings.wechat.unbound"));
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
    <section className="surface p-5 sm:p-6">
      <SectionHeader note={t("settings.wechat.bindingNote")} title={t("settings.wechat.bindingTitle")}
        action={bindingsData.length > 0 && (
          <StatusChip tone="muted">{t("settings.wechat.bindingCount", { count: bindingsData.length })}</StatusChip>
        )} />

      {bindings.isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
      ) : primaryBinding ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 py-3.5 border-b border-border">
            <div className="min-w-0">
              <p className="text-sm text-foreground font-medium truncate">
                {primaryBinding.wechatName || t("settings.wechat.myWechat")}
              </p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {t("settings.wechat.replyingWith", { name: personaNameById.get(primaryBinding.personaId) ?? `#${primaryBinding.personaId}` })}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <StatusChip tone="success">{t("settings.wechat.active")}</StatusChip>
              <button onClick={() => setUnbindTarget({
                id: primaryBinding.id,
                label: primaryBinding.wechatName || t("settings.wechat.myWechat"),
              })}
                title={t("settings.wechat.unbind")}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" id="wechat-reply-persona-label" htmlFor="wechat-reply-persona">{t("settings.wechat.replyPersona")}</Label>
            <div className="flex gap-2">
              <Select value={selectedPersonaId} onValueChange={setSelectedPersonaId}>
                <SelectTrigger id="wechat-reply-persona" aria-labelledby="wechat-reply-persona-label" className="h-9 rounded-md text-sm w-full">
                  <SelectValue placeholder={t("settings.wechat.selectPersona")} />
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
                {setDefault.isPending ? t("common.saving") : t("common.save")}
              </Button>
            </div>
            {readyPersonas.length === 0 && (
              <p className="text-[0.6875rem] text-muted-foreground leading-relaxed">
                {t("settings.wechat.noAnalyzed")}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {connected ? t("settings.wechat.noDefault") : t("settings.wechat.connectFirst")}
          </p>
        </div>
      )}

      {/* 解除绑定确认 */}
      <Dialog open={!!unbindTarget} onOpenChange={open => !open && setUnbindTarget(null)}>
        <DialogContent className="bg-card border-border rounded-lg max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">{t("settings.wechat.unbind")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2 leading-relaxed">
            {t("settings.wechat.unbindBody")}
          </p>
          <DialogFooter>
            <Button variant="ghost" className="rounded-md" onClick={() => setUnbindTarget(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" className="rounded-md px-5"
              disabled={unbind.isPending}
              onClick={() => unbindTarget && unbind.mutate({ id: unbindTarget.id })}>
              {unbind.isPending ? t("settings.wechat.unbinding") : t("settings.wechat.confirmUnbind")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─── WECHAT COMMANDS HELP ───────────────────────────────────────────────────

function WeChatCommandsSection() {
  const { t } = useLocale();
  /* The commands themselves are the protocol — the server matches them verbatim. */
  const commands = [
    t("settings.wechat.commandUse"),
    t("settings.wechat.commandList"),
    t("settings.wechat.commandCurrent"),
    t("settings.wechat.commandGraduate"),
  ];
  const descs = Array.from(t("settings.wechat.commandDescs"));

  return (
    <section className="surface p-5 sm:p-6">
      <SectionHeader note={t("settings.wechat.commandsNote")} title={t("settings.wechat.commandsTitle")} />
      <div className="space-y-2.5">
        {commands.map((c, i) => (
          <div key={c} className="flex items-baseline gap-3">
            <code className="text-xs font-mono text-foreground bg-muted/50 px-2 py-1 rounded flex-shrink-0">
              {c}
            </code>
            <span className="text-xs text-muted-foreground">{descs[i]}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[0.6875rem] text-muted-foreground leading-relaxed">
        {t("settings.wechat.commandsHint")}
      </p>
    </section>
  );
}

// ─── DATA MANAGEMENT TAB ─────────────────────────────────────────────────────

function DataManagementTab() {
  const [, navigate] = useLocation();
  const { logout } = useAuth();
  const { t } = useLocale();
  const { data: accountStats } = trpc.user.getAccountStats.useQuery();
  const exportData = trpc.user.exportData.useMutation({
    onSuccess: (data) => {
      if (!data) return;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mirrai-export-${new Date().toISOString().slice(0, 10)}.json`;
      // The URL is released a moment later, not straight away.
      //
      // The download starts asynchronously, so revoking it in the same
      // tick can leave the browser with no file at all — in Firefox and
      // Safari it produced nothing, while the toast still said
      // "exported". The user believed their data was backed up, and it
      // was not.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t("settings.data.exportSuccess"));
    },
    onError: (e: any) => toast.error(t("settings.data.exportFailed", { message: e.message })),
  });

  /* The full export: every persona, every memory, every diary, the
     farewell letter, the relationship events and the user's own moods —
     in a format that does not need this app. */
  const exportAll = trpc.chat.exportAll.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.content], { type: data.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.fileName;
      // The URL is released a moment later — see the note above.
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t("settings.data.exportSuccess"));
    },
    onError: (e: any) => toast.error(t("settings.data.exportFailed", { message: e.message })),
  });

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  /**
   * The phrase the user has to type, captured when the dialog opens.
   *
   * It was compared against the *localised* string, so changing the
   * language while the dialog was open left the destructive button
   * permanently disabled — and the user had no way of finding out why.
   */
  /**
   * The phrase the user has to type.
   *
   * It is captured when the dialog opens, so a change of language in
   * the meantime does not lock the user out of the button they are
   * trying to press.
   *
   * It used to be captured inside the dialog's `onOpenChange`, which
   * Radix calls when the dialog *asks* to be closed — never when the
   * `open` property says it has opened. So the phrase was never
   * captured at all, the button was never enabled, and the account
   * could never be deleted.
   */
  const [expectedPhrase, setExpectedPhrase] = useState("");
  useEffect(() => {
    if (showDeleteDialog) setExpectedPhrase(t("settings.data.phrase"));
  }, [showDeleteDialog, t]);
  const deleteAccount = trpc.user.deleteAccount.useMutation({
    onSuccess: () => {
      toast.success(t("settings.data.accountDeleted"));
      // The logout is awaited: the account is gone, so the session has
      // to go with it, and a failure to log out has to be reported
      // rather than swallowed.
      void logout()
        .catch((e: any) => toast.error(e?.message ?? t("common.error")))
        .finally(() => navigate(getLoginUrl()));
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
        <section className="surface p-5 sm:p-6">
          <SectionHeader note={t("settings.data.storageNote")} title={t("settings.data.storageTitle")} />
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("settings.data.used")}</span>
              <span className="font-medium text-foreground">{formatBytes(accountStats.storageUsed)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="progress-bar h-full"
                style={{ width: `${Math.min(100, (accountStats.storageUsed / (100 * 1048576)) * 100)}%` }} />
            </div>
            <div className="stat-grid grid-cols-3 mt-3">
              <div className="stat-block">
                <div className="stat-value">{accountStats.totalPersonas}</div>
                <div className="stat-label mt-0.5">{t("settings.data.statPersonas")}</div>
              </div>
              <div className="stat-block">
                <div className="stat-value">{accountStats.totalMessages}</div>
                <div className="stat-label mt-0.5">{t("settings.data.statMessages")}</div>
              </div>
              <div className="stat-block">
                <div className="stat-value">{accountStats.totalFiles}</div>
                <div className="stat-label mt-0.5">{t("settings.data.statFiles")}</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Export */}
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.data.exportNote")} title={t("settings.data.exportTitle")} />
        <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
          {t("settings.data.exportDescription")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent"
            onClick={() => exportAll.mutate({ format: "json" })}
            disabled={exportAll.isPending}>
            <Download className="w-3.5 h-3.5" />
            {exportAll.isPending ? t("settings.data.exporting") : t("settings.data.exportJson")}
          </Button>
          <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent"
            onClick={() => exportAll.mutate({ format: "markdown" })}
            disabled={exportAll.isPending}>
            <Download className="w-3.5 h-3.5" />
            {t("settings.data.exportMarkdown")}
          </Button>
        </div>
      </section>

      {/* Install */}
      <InstallAppSection />

      {/* Danger Zone */}
      <section className="rounded-lg border border-destructive/30 bg-card p-6 sm:p-7">
        <SectionHeader note={t("settings.data.dangerNote")} title={t("settings.data.dangerTitle")} danger />
        <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/15">
          <p className="text-sm text-foreground font-medium mb-1">{t("settings.data.deleteTitle")}</p>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            {t("settings.data.deleteDescription")}
          </p>
          <Button size="sm" variant="destructive" className="rounded-md px-5"
            onClick={() => setShowDeleteDialog(true)}>
            <Trash2 className="w-3.5 h-3.5" /> {t("settings.data.deleteTitle")}
          </Button>
        </div>
      </section>

      {/* Delete Account Dialog */}
      <Dialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
      >
        <DialogContent className="bg-card border-border rounded-lg max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-destructive">{t("settings.data.confirmTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/15">
              <p className="text-xs text-destructive leading-relaxed">
                {t("settings.data.confirmBody", {
                  personas: accountStats?.totalPersonas || 0,
                  messages: accountStats?.totalMessages || 0,
                  files: accountStats?.totalFiles || 0,
                })}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/80" htmlFor="delete-account-password">{t("settings.data.passwordLabel")}</Label>
              <Input id="delete-account-password" value={deletePassword} onChange={e => setDeletePassword(e.target.value)}
                type="password" placeholder={t("settings.data.passwordPlaceholder")}
                className="h-10 rounded-md" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm text-foreground/80" htmlFor="delete-account-phrase">
                {t("settings.data.phraseLabel", { phrase: t("settings.data.phrase") })}
              </Label>
              <Input id="delete-account-phrase" value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder={t("settings.data.phrase")}
                className="h-10 rounded-md" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteDialog(false)} className="rounded-md">{t("common.cancel")}</Button>
            <Button variant="destructive" className="rounded-md px-5"
              disabled={!deletePassword || deleteConfirmText !== expectedPhrase || deleteAccount.isPending}
              onClick={() => deleteAccount.mutate({ confirmPassword: deletePassword })}>
              {deleteAccount.isPending ? t("common.deleting") : t("settings.data.permanent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── CHANNELS TAB ────────────────────────────────────────────────────────────

const CHANNEL_STATUS_LABELS: Record<string, "settings.channels.status.connected" | "settings.channels.status.configured" | "settings.channels.status.stopped" | "settings.channels.status.error" | "settings.channels.status.scanning" | "settings.channels.status.scaned" | "settings.channels.status.needVerifycode"> = {
  connected: "settings.channels.status.connected",
  logged_in: "settings.channels.status.connected",
  configured: "settings.channels.status.configured",
  stopped: "settings.channels.status.stopped",
  error: "settings.channels.status.error",
  scanning: "settings.channels.status.scanning",
  scaned: "settings.channels.status.scaned",
  need_verifycode: "settings.channels.status.needVerifycode",
};

function ChannelStatusChip({ connected, status }: { connected: boolean; status: string }) {
  const { t } = useLocale();
  const tone: ChipTone = connected
    ? "success"
    : status === "error" ? "error"
    : status === "stopped" ? "muted"
    : "info";
  const labelKey = CHANNEL_STATUS_LABELS[status];
  return <StatusChip tone={tone}>{labelKey ? t(labelKey) : status}</StatusChip>;
}

function ChannelsTab({ onOpenTab }: { onOpenTab: (key: TabKey) => void }) {
  const { t } = useLocale();
  const channels = trpc.channel.list.useQuery();

  return (
    <div className="space-y-5">
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.channels.overviewNote")} title={t("settings.channels.overviewTitle")} />
        {channels.isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : (
          <div>
            {(channels.data ?? []).map(channel => (
              <div key={channel.id}
                className="flex items-center justify-between gap-3 py-3.5 border-b border-border last:border-b-0">
                <div className="min-w-0">
                  <p className="text-sm text-foreground font-medium truncate">{channel.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {channel.requiresCredentials ? t("settings.channels.needsCredentials") : t("settings.channels.scanAuth")}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ChannelStatusChip connected={channel.connected} status={channel.status} />
                  {channel.id === "wechat" && (
                    <Button size="sm" variant="ghost" className="rounded-md text-xs h-7 px-3"
                      onClick={() => onOpenTab("wechat")}>
                      {t("settings.channels.goToSettings")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <FeishuSection />
    </div>
  );
}

// ─── FEISHU CHANNEL ──────────────────────────────────────────────────────────

function FeishuSection() {
  const { t } = useLocale();
  const status = trpc.channel.getStatus.useQuery({ channel: "feishu" });
  const setCredentials = trpc.channel.setCredentials.useMutation({
    onSuccess: () => { toast.success(t("settings.channels.credentialsSaved")); status.refetch(); setAppSecret(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const startChannel = trpc.channel.start.useMutation({
    onSuccess: () => { toast.success(t("settings.channels.feishu.connected")); status.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  const stopChannel = trpc.channel.stop.useMutation({
    onSuccess: () => { toast.success(t("settings.channels.feishu.disconnected")); status.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");

  const connected = status.data?.connected === true;
  const lastError = (status.data?.detail as { error?: string } | null | undefined)?.error;
  const canSave = appId.trim().length > 0 && appSecret.trim().length > 0 && !setCredentials.isPending;

  return (
    <section className="surface p-5 sm:p-6">
      <SectionHeader note={t("settings.channels.feishu.note")} title={t("settings.channels.feishu.title")}
        action={<ChannelStatusChip connected={connected} status={status.data?.status ?? "stopped"} />} />

      <div className="p-4 rounded-lg bg-muted/30 border border-border">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("settings.channels.feishu.introLead")}
          <span className="text-foreground font-medium">{t("settings.channels.feishu.introEmphasis")}</span>
          {t("settings.channels.feishu.introTail")}
        </p>
        <ul className="mt-2.5 space-y-1.5 text-xs text-muted-foreground leading-relaxed list-disc pl-4">
          <li>
            {t("settings.channels.feishu.reqEnterpriseLead")}
            <span className="text-foreground font-medium">{t("settings.channels.feishu.reqEnterpriseEmphasis")}</span>
            {t("settings.channels.feishu.reqEnterpriseTail")}
          </li>
          <li>
            {t("settings.channels.feishu.reqPublishLead")}
            <span className="text-foreground font-medium">{t("settings.channels.feishu.reqPublishEmphasis")}</span>
            {t("settings.channels.feishu.reqPublishTail")}
          </li>
          <li>
            {t("settings.channels.feishu.reqEventsLead")}
            <span className="text-foreground font-medium">{t("settings.channels.feishu.reqEventsEmphasis")}</span>
            {t("settings.channels.feishu.reqEventsTail")}
            <code className="font-mono text-foreground bg-muted/60 px-1 py-0.5 rounded">im.message.receive_v1</code>
            {t("settings.channels.feishu.reqEventsEnd")}
          </li>
          <li>
            {t("settings.channels.feishu.reqPermissionsLead")}
            <code className="font-mono text-foreground bg-muted/60 px-1 py-0.5 rounded">im:message</code>
            {t("settings.channels.feishu.reqPermissionsSeparator")}
            <code className="font-mono text-foreground bg-muted/60 px-1 py-0.5 rounded">im:message:readonly</code>
            {t("settings.channels.feishu.reqPermissionsSeparator")}
            <code className="font-mono text-foreground bg-muted/60 px-1 py-0.5 rounded">im:message.p2p_msg:readonly</code>
            {t("settings.channels.feishu.reqPermissionsSeparator")}
            <code className="font-mono text-foreground bg-muted/60 px-1 py-0.5 rounded">im:message.group_at_msg:readonly</code>
            {t("settings.channels.feishu.reqPermissionsSeparator")}
            <code className="font-mono text-foreground bg-muted/60 px-1 py-0.5 rounded">im:message:send_as_bot</code>
            {t("settings.channels.feishu.reqPermissionsEnd")}
          </li>
          <li>
            {t("settings.channels.feishu.reqEncryptionLead")}
            <span className="text-foreground font-medium">{t("settings.channels.feishu.reqEncryptionEmphasis")}</span>
            {t("settings.channels.feishu.reqEncryptionTail")}
          </li>
        </ul>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground" htmlFor="channel-app-id">{t("settings.channels.appId")}</Label>
          <Input id="channel-app-id" value={appId} onChange={e => setAppId(e.target.value)}
            placeholder="cli_xxxxxxxxxxxx" className="h-9 rounded-md text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground" htmlFor="channel-app-secret">{t("settings.channels.appSecret")}</Label>
          <Input id="channel-app-secret" value={appSecret} onChange={e => setAppSecret(e.target.value)}
            type="password" placeholder="••••••••" className="h-9 rounded-md text-sm" />
        </div>
      </div>

      {lastError && (
        <p className="mt-4 text-xs text-destructive leading-relaxed">{lastError}</p>
      )}

      <div className="flex gap-2 mt-5">
        <Button size="sm" className="rounded-md px-5" disabled={!canSave}
          onClick={() => setCredentials.mutate({
            channel: "feishu",
            appId: appId.trim(),
            appSecret: appSecret.trim(),
          })}>
          {setCredentials.isPending ? t("common.saving") : t("settings.channels.saveCredentials")}
        </Button>
        {connected ? (
          <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent"
            onClick={() => stopChannel.mutate({ channel: "feishu" })} disabled={stopChannel.isPending}>
            <Unplug className="w-3.5 h-3.5" />
            {stopChannel.isPending ? t("settings.channels.feishu.disconnecting") : t("settings.channels.disconnect")}
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent"
            onClick={() => startChannel.mutate({ channel: "feishu" })} disabled={startChannel.isPending}>
            <Plug className="w-3.5 h-3.5" />
            {startChannel.isPending ? t("settings.channels.feishu.connecting") : t("settings.channels.feishu.connect")}
          </Button>
        )}
      </div>
    </section>
  );
}

// ─── DATA SOURCES TAB ────────────────────────────────────────────────────────

type CollectorSourceId = "feishu" | "dingtalk" | "slack" | "email" | "wechat_export";

const COLLECTOR_STATUS_LABELS: Record<string, "settings.sources.jobStatus.queued" | "settings.sources.jobStatus.running" | "settings.sources.jobStatus.completed" | "settings.sources.jobStatus.failed" | "settings.sources.jobStatus.interrupted"> = {
  queued: "settings.sources.jobStatus.queued",
  running: "settings.sources.jobStatus.running",
  completed: "settings.sources.jobStatus.completed",
  failed: "settings.sources.jobStatus.failed",
  interrupted: "settings.sources.jobStatus.interrupted",
};

/** A file as base64, without the data-url prefix. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function DataSourcesTab() {
  const { t, locale } = useLocale();
  const sources = trpc.collector.listSources.useQuery();
  const personas = trpc.persona.list.useQuery();
  const jobs = trpc.collector.listJobs.useQuery(undefined, {
    refetchInterval: query => {
      const list = query.state.data;
      return list?.some(job => job.status === "queued" || job.status === "running") ? 1500 : false;
    },
  });
  const authorizedSources = trpc.collector.listAuthorizedSources.useQuery();
  const startJob = trpc.collector.start.useMutation({
    onSuccess: () => { toast.success(t("settings.sources.jobQueued")); jobs.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });
  /**
   * The file a source reads, uploaded first.
   *
   * The collector is pointed at a file on the server's disk, so the
   * file has to be there — and it has to be the user's own, which is
   * why it is uploaded as one of the persona's files.
   */
  const uploadSourceFile = trpc.file.upload.useMutation();

  const [sourceId, setSourceId] = useState<CollectorSourceId | "">("");
  /**
   * The file a source reads.
   *
   * The e-mail and the WeChat export sources read a file the user has:
   * an export of their own mail, or of their own chat history. There
   * was nowhere to give it, so both sources failed the moment they
   * were chosen.
   */
  const [sourceFileId, setSourceFileId] = useState<number | null>(null);
  const [sourceFileName, setSourceFileName] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [target, setTarget] = useState("");
  const [limit, setLimit] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  /**
   * The distillation preset the collected material is distilled with.
   *
   * The same preset the upload page offers — one vocabulary for the two
   * places where a persona is built.
   */
  const [mode, setMode] = useState<DistillationMode>(DEFAULT_DISTILLATION_MODE);

  const startPipeline = trpc.skillEngine.startPipeline.useMutation({
    onSuccess: () => {
      toast.success(t("settings.sources.importStarted"));
      jobs.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  /** Keeps the persona's remembered preset in step with the picker. */
  const saveModeMutation = trpc.persona.update.useMutation({
    onError: (e: any) => toast.error(e.message),
  });

  const authorizeSource = trpc.collector.authorizeSource.useMutation({
    onSuccess: () => {
      toast.success(t("settings.sources.authorized"));
      authorizedSources.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const sourceList = sources.data ?? [];
  const sourceLabelById = new Map(sourceList.map(s => [s.id, s.label]));
  const selectedSource = sourceList.find(s => s.id === sourceId);
  const credentialKeys = selectedSource?.credentialKeys ?? [];
  const allCredentialsFilled =
    credentialKeys.length > 0 && credentialKeys.every(key => (credentials[key] ?? "").trim().length > 0);
  const personaList = personas.data ?? [];
  const selectedPersona = personaList.find(p => String(p.id) === personaId);

  // The persona remembers the preset it was built with, so the picker
  // starts from that rather than from the default.
  useEffect(() => {
    // The persona remembers the preset it was built with, so the picker
    // starts from that rather than from the default.
    //
    // The default is applied too: it used to be applied only when the
    // newly chosen persona had a preset of its own, so a persona with
    // none silently ran with the previous persona's.
    const saved = selectedPersona?.distillationMode;
    setMode((saved as DistillationMode) ?? DEFAULT_DISTILLATION_MODE);
  }, [selectedPersona?.id, selectedPersona?.distillationMode]);

  function handleStart() {
    if (!sourceId || !personaId) return;
    const parsedLimit = limit.trim() ? Number(limit) : undefined;
    startJob.mutate({
      source: sourceId,
      personaId: Number(personaId),
      target: target.trim() || undefined,
      limit: parsedLimit && Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      fileId: sourceFileId ?? undefined,
    });
  }

  return (
    <div className="space-y-5">
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.sources.availableNote")} title={t("settings.sources.availableTitle")} />
        {sources.isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : (
          <div className="space-y-2.5">
            {sourceList.map(source => (
              <div key={source.id} className="surface p-3.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-foreground font-medium">{source.label}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {source.requiresBrowser
                      ? t("settings.sources.needsBrowserLong")
                      : t("settings.sources.noBrowser")}
                  </p>
                </div>
                {source.requiresBrowser && <StatusChip tone="muted">{t("settings.sources.needsBrowserChip")}</StatusChip>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.sources.startNote")} title={t("settings.sources.startTitle")} />
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" id="source-select-label" htmlFor="source-select">{t("settings.sources.sourceLabel")}</Label>
            <Select value={sourceId} onValueChange={v => {
              setSourceId(v as CollectorSourceId);
              // The credentials of the platform that was chosen before
              // are let go of.
              //
              // Feishu uses `app_id`/`app_secret` and DingTalk uses
              // `app_key`/`app_secret`, so the secret of one platform
              // stayed in the other's field — and "Authorize" was then
              // satisfied by it, and the secret was written into the
              // other platform's credential store. One platform's secret
              // was handed to another.
              setCredentials({});
            }}>
              <SelectTrigger id="source-select" aria-labelledby="source-select-label" className="h-9 rounded-md text-sm w-full">
                <SelectValue placeholder={t("settings.sources.selectPlatform")} />
              </SelectTrigger>
              <SelectContent>
                {sourceList.map(source => (
                  <SelectItem key={source.id} value={source.id}>{source.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSource?.requiresBrowser && (
              <p className="text-[0.6875rem] text-muted-foreground leading-relaxed">
                {t("settings.sources.browserWarning")}
              </p>
            )}
          </div>

          {/* Authorisation. The credentials are sent once and stored
              encrypted — the platform never sees them again. */}
          {credentialKeys.length > 0 && (
            <div className="space-y-2.5 p-3.5 rounded-md border border-border bg-muted/20">
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("settings.sources.authorizeNote")}
              </p>
              {credentialKeys.map(key => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground" htmlFor={`credential-${key}`}>
                    {t(`settings.sources.credentialLabels.${key}` as any)}
                  </Label>
                  <Input
                    id={`credential-${key}`}
                    type={key.toLowerCase().includes("secret") || key.toLowerCase().includes("token") ? "password" : "text"}
                    value={credentials[key] ?? ""}
                    onChange={e => setCredentials(prev => ({ ...prev, [key]: e.target.value }))}
                    placeholder={t("settings.sources.credentialPlaceholder")}
                    className="h-9 rounded-md text-sm"
                  />
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="rounded-md px-5"
                disabled={authorizeSource.isPending || !allCredentialsFilled}
                onClick={() => authorizeSource.mutate({ source: sourceId as CollectorSourceId, credentials })}
              >
                {authorizeSource.isPending ? t("settings.sources.authorizing") : t("settings.sources.authorize")}
              </Button>
              {(authorizedSources.data ?? []).some(s => s.source === sourceId) && (
                <p className="text-xs text-primary">{t("settings.sources.authorized")}</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" id="source-persona-label" htmlFor="source-persona">{t("settings.sources.personaLabel")}</Label>
            <Select value={personaId} onValueChange={setPersonaId}>
              <SelectTrigger id="source-persona" aria-labelledby="source-persona-label" className="h-9 rounded-md text-sm w-full">
                <SelectValue placeholder={t("settings.sources.selectPersona")} />
              </SelectTrigger>
              <SelectContent>
                {personaList.map(persona => (
                  <SelectItem key={persona.id} value={String(persona.id)}>{persona.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {personaList.length === 0 && (
              <p className="text-[0.6875rem] text-muted-foreground">{t("settings.sources.noPersona")}</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground" htmlFor="source-target">{t("settings.sources.targetLabel")}</Label>
              <Input id="source-target" value={target} onChange={e => setTarget(e.target.value)}
                placeholder={t("settings.sources.targetPlaceholder")} className="h-9 rounded-md text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground" htmlFor="source-limit">{t("settings.sources.limitLabel")}</Label>
              <Input id="source-limit" value={limit} onChange={e => setLimit(e.target.value)}
                placeholder={t("settings.sources.limitPlaceholder")} className="h-9 rounded-md text-sm" inputMode="numeric" />
            </div>
          </div>

          {selectedSource?.needsFile && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground" htmlFor="source-file">{t("settings.sources.fileLabel")}</Label>
              <input
                id="source-file"
                type="file"
                accept=".txt,.csv,.json,.eml,.mbox"
                aria-label={t("settings.sources.fileLabel")}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !personaId) return;
                  try {
                    const content = await fileToBase64(file);
                    const uploaded = await uploadSourceFile.mutateAsync({
                      personaId: Number(personaId),
                      fileName: file.name,
                      fileType: "chat_txt",
                      fileSize: file.size,
                      fileContent: content,
                      mimeType: file.type || "text/plain",
                    });
                    setSourceFileId(uploaded.fileId);
                    setSourceFileName(file.name);
                  } catch (e: any) {
                    toast.error(e?.message ?? t("settings.sources.fileUploadFailed"));
                  }
                }}
                className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-muted/80"
              />
              {sourceFileName && (
                <p className="text-[0.6875rem] text-muted-foreground">{sourceFileName}</p>
              )}
            </div>
          )}

          <Button size="sm" className="rounded-md px-5"
            disabled={!sourceId || !personaId || startJob.isPending || (selectedSource?.needsFile && !sourceFileId)}
            onClick={handleStart}>
            {startJob.isPending ? t("settings.sources.submitting") : t("settings.sources.start")}
          </Button>
        </div>
      </section>

      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.sources.jobsNote")} title={t("settings.sources.jobsTitle")} />
        {jobs.isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : (jobs.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.sources.noJobs")}</p>
        ) : (
          <div className="space-y-2.5">
            {(jobs.data ?? []).map(job => (
              <div key={job.id} className="surface p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground font-medium truncate">
                      {sourceLabelById.get(job.source) ?? job.source}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {job.startedAt ? new Date(job.startedAt).toLocaleString(locale) : t("settings.sources.notStarted")}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <StatusChip tone={
                      job.status === "completed" ? "success"
                      : job.status === "failed" ? "error"
                      : job.status === "interrupted" ? "muted"
                      : "info"
                    }>
                      {COLLECTOR_STATUS_LABELS[job.status] ? t(COLLECTOR_STATUS_LABELS[job.status]) : job.status}
                    </StatusChip>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{t("settings.sources.messageCount", { count: job.messageCount })}</span>
                  </div>
                </div>

                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="progress-bar h-full" style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }} />
                </div>

                {job.error && (
                  <p className="text-xs text-destructive leading-relaxed">{job.error}</p>
                )}

                <button type="button"
                  onClick={() => setSelectedJobId(job.id === selectedJobId ? null : job.id)}
                  className="text-xs text-primary hover:text-primary/80 px-0">
                  {job.id === selectedJobId ? t("settings.sources.collapse") : t("settings.sources.expand")}
                </button>

                {job.id === selectedJobId && <CollectorJobDetail jobId={job.id} />}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Preview, and the step that hands the material to the model. */}
      {personaId && (
        <section className="surface p-5 sm:p-6">
          <SectionHeader note={t("settings.sources.previewNote")} title={t("settings.sources.previewTitle")} />
          <CollectorPreview personaId={Number(personaId)} />

          {/* 「导入到分身」— the last step of the flow. The collected rows
              become the material the persona is distilled from. */}
          <div className="mt-4 pt-4 border-t border-border space-y-3">
            <div className="space-y-1.5">
              {/* The picker names itself — it is a radiogroup with its
                  own label — so this is a heading rather than a label
                  for a control that is not there. */}
              <p className="text-xs text-muted-foreground">{t("distillation.title")}</p>
              <DistillationModePicker
                value={mode}
                onChange={next => {
                  setMode(next);
                  // The preset is remembered on the persona, so a re-run
                  // keeps the same choice.
                  if (personaId) {
                    saveModeMutation.mutate({ id: Number(personaId), distillationMode: next });
                  }
                }}
              />
            </div>

            <Button
              size="sm"
              className="rounded-md px-5"
              disabled={startPipeline.isPending}
              onClick={() =>
                startPipeline.mutate({
                  personaId: Number(personaId),
                  mode,
                })
              }
            >
              {startPipeline.isPending
                ? t("settings.sources.importing")
                : t("settings.sources.importToPersona")}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function CollectorPreview({ personaId }: { personaId: number }) {
  const { t, locale } = useLocale();
  const { data, isLoading } = trpc.collector.preview.useQuery(
    { personaId, limit: 30 },
    { enabled: Number.isFinite(personaId) && personaId > 0 },
  );

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;
  }
  if (!data || data.total === 0) {
    return <p className="text-xs text-muted-foreground">{t("settings.sources.previewEmpty")}</p>;
  }

  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground">
        {t("settings.sources.previewTotal", { count: data.total })}
      </p>
      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {data.messages.map(message => (
          <div key={message.id} className="rounded-md border border-border p-2.5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[0.6875rem] text-muted-foreground">
                {message.role === "user" ? t("settings.sources.previewMe") : t("settings.sources.previewThem")}
              </span>
              {message.source && (
                <span className="text-[0.6875rem] text-muted-subtle">{message.source}</span>
              )}
              {message.timestamp && (
                <span className="text-[0.6875rem] text-muted-subtle ml-auto">
                  {new Date(message.timestamp).toLocaleString(locale)}
                </span>
              )}
            </div>
            <p className="text-xs text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CollectorJobDetail({ jobId }: { jobId: string }) {
  const { t, locale } = useLocale();
  const { data: job } = trpc.collector.getJob.useQuery({ jobId });
  if (!job) return <p className="text-xs text-muted-foreground">{t("common.loading")}</p>;

  const statusKey = COLLECTOR_STATUS_LABELS[job.status];
  const rows: Array<[string, string]> = [
    [t("settings.sources.jobId"), job.id],
    [t("settings.sources.sourceLabel"), job.source],
    [t("settings.sources.status"), statusKey ? t(statusKey) : job.status],
    [t("settings.sources.progress"), `${job.progress}%`],
    [t("settings.sources.messageCountLabel"), String(job.messageCount)],
    [t("settings.sources.startedAt"), job.startedAt ? new Date(job.startedAt).toLocaleString(locale) : "—"],
    [t("settings.sources.finishedAt"), job.finishedAt ? new Date(job.finishedAt).toLocaleString(locale) : "—"],
  ];

  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-1.5">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-3 text-xs">
          <span className="text-muted-foreground flex-shrink-0">{label}</span>
          <span className="text-foreground text-right break-all">{value}</span>
        </div>
      ))}
      {job.error && <p className="text-xs text-destructive leading-relaxed">{job.error}</p>}
    </div>
  );
}

// ─── TEMPLATE LIBRARY TAB ────────────────────────────────────────────────────

const TEMPLATE_FAMILY_LABELS: Record<string, "settings.templates.family.colleague" | "settings.templates.family.relationship" | "settings.templates.family.celebrity"> = {
  colleague: "settings.templates.family.colleague",
  relationship: "settings.templates.family.relationship",
  celebrity: "settings.templates.family.celebrity",
};

function parseTags(raw: string): string[] {
  return raw.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).slice(0, 20);
}

function TemplateLibraryTab() {
  const [, navigate] = useLocation();
  const { t } = useLocale();
  const templates = trpc.template.list.useQuery();
  const personas = trpc.persona.list.useQuery();
  const instantiate = trpc.template.instantiate.useMutation({
    onSuccess: (data) => {
      toast.success(t("settings.templates.instantiated"));
      personas.refetch();
      navigate(`/chat/${data.personaId}`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const importTemplate = trpc.template.import.useMutation({
    onSuccess: data => {
      toast.success(t("settings.templates.imported"));
      setOwnRowIds(prev => ({ ...prev, [data.templateId]: data.id }));
      templates.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const createFromPersona = trpc.template.createFromPersona.useMutation({
    onSuccess: data => {
      toast.success(t("settings.templates.created"));
      setOwnRowIds(prev => ({ ...prev, [data.templateId]: data.id }));
      templates.refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteTemplate = trpc.template.delete.useMutation({
    onSuccess: () => { toast.success(t("settings.templates.deleted")); templates.refetch(); },
    onError: (e: any) => toast.error(e.message),
  });

  const [personaId, setPersonaId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [exportRequest, setExportRequest] = useState<{ templateId: string; nonce: number } | null>(null);
  const [ownRowIds, setOwnRowIds] = useState<Record<string, number>>({});
  const importInputRef = useRef<HTMLInputElement>(null);

  const exportQuery = trpc.template.export.useQuery(
    { templateId: exportRequest?.templateId ?? "" },
    { enabled: exportRequest !== null },
  );

  useEffect(() => {
    const data = exportQuery.data;
    if (!data) return;
    const blob = new Blob([data.content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.fileName;
    // The URL is released a moment later — see the note in the data tab.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(t("settings.templates.exported"));
    // The nonce alone decides when the file is downloaded.
    //
    // `t` was in the list, and it is a fresh function every time the
    // locale changes — so switching the language in Settings re-fired
    // the template download behind the user's back.
  }, [exportRequest?.nonce, exportQuery.data]);

  const templateList = templates.data ?? [];
  const builtinTemplates = templateList.filter(t => t.builtin);
  const ownTemplates = templateList.filter(t => !t.builtin);
  const readyPersonas = (personas.data ?? []).filter(p => p.analysisStatus === "ready");

  function rowIdFor(templateId: string): number | undefined {
    const known = ownRowIds[templateId];
    if (typeof known === "number") return known;
    const fromServer = (templates.data ?? []).find(t => t.id === templateId) as any;
    return typeof fromServer?.rowId === "number" ? fromServer.rowId : undefined;
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const fileContent = await file.text();
      importTemplate.mutate({ fileContent });
    } catch {
      toast.error(t("settings.templates.readFailed"));
    }
  }

  return (
    <div className="space-y-5">
      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.templates.note")} title={t("settings.templates.title")}
          action={(
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {t("settings.templates.countLead")} <span className="text-foreground font-medium">{templateList.length}</span> {t("settings.templates.countTail")}
            </span>
          )} />
        {templates.isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : (
          <div className="space-y-6">
            {[
              { title: t("settings.templates.builtinGroup"), list: builtinTemplates },
              { title: t("settings.templates.mineGroup"), list: ownTemplates },
            ].map(group => (
              <div key={group.title} className="space-y-2.5">
                <p className="text-xs text-muted-foreground">{group.title}</p>
                {group.list.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("settings.templates.empty")}</p>
                ) : group.list.map(template => {
                  const rowId = rowIdFor(template.id);
                  const familyKey = TEMPLATE_FAMILY_LABELS[template.family];
                  return (
                    <div key={template.id} className="surface p-3.5 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-foreground font-medium truncate">{template.name}</span>
                            <StatusChip tone="muted">
                              {familyKey ? t(familyKey) : template.family}
                            </StatusChip>
                            {template.builtin && <StatusChip tone="primary">{t("templates.builtin")}</StatusChip>}
                          </div>
                          {template.description && (
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{template.description}</p>
                          )}
                          {template.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {template.tags.map(tag => (
                                <span key={tag}
                                  className="text-[0.6875rem] text-muted-foreground bg-muted/50 border border-border rounded px-1.5 py-0.5">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <Button size="sm" className="rounded-md px-4" disabled={instantiate.isPending}
                          onClick={() => instantiate.mutate({ templateId: template.id })}>
                          <Package className="w-3.5 h-3.5" /> {t("settings.templates.use")}
                        </Button>
                        <Button size="sm" variant="outline" className="rounded-md px-4 bg-transparent"
                          onClick={() => setExportRequest(prev => ({
                            templateId: template.id,
                            nonce: (prev?.nonce ?? 0) + 1,
                          }))}>
                          <FileJson className="w-3.5 h-3.5" /> {t("common.export")}
                        </Button>
                        {!template.builtin && (
                          <Button size="sm" variant="ghost"
                            className="rounded-md px-4 text-destructive hover:text-destructive hover:bg-destructive/10"
                            disabled={!rowId || deleteTemplate.isPending}
                            title={rowId ? t("settings.templates.deleteTitle") : t("settings.templates.deleteUnavailable")}
                            onClick={() => { if (rowId) deleteTemplate.mutate({ id: rowId }); }}>
                            <Trash2 className="w-3.5 h-3.5" /> {t("common.delete")}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.templates.fromPersonaNote")} title={t("settings.templates.fromPersonaTitle")} />
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" id="template-persona-label" htmlFor="template-persona">{t("settings.sources.personaLabel")}</Label>
            <Select value={personaId} onValueChange={setPersonaId}>
              <SelectTrigger id="template-persona" aria-labelledby="template-persona-label" className="h-9 rounded-md text-sm w-full">
                <SelectValue placeholder={t("settings.templates.selectAnalyzed")} />
              </SelectTrigger>
              <SelectContent>
                {readyPersonas.map(persona => (
                  <SelectItem key={persona.id} value={String(persona.id)}>{persona.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {readyPersonas.length === 0 && (
              <p className="text-[0.6875rem] text-muted-foreground">
                {t("settings.templates.noAnalyzed")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground" htmlFor="template-name">{t("settings.templates.nameLabel")}</Label>
              <Input id="template-name" value={name} onChange={e => setName(e.target.value)}
                placeholder={t("settings.templates.namePlaceholder")} className="h-9 rounded-md text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground" htmlFor="template-tags">{t("settings.templates.tagsLabel")}</Label>
              <Input id="template-tags" value={tags} onChange={e => setTags(e.target.value)}
                placeholder={t("settings.templates.tagsPlaceholder")} className="h-9 rounded-md text-sm" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="template-description">{t("settings.templates.descriptionLabel")}</Label>
            <Textarea id="template-description" value={description} onChange={e => setDescription(e.target.value)}
              placeholder={t("settings.templates.descriptionPlaceholder")} className="min-h-16 text-sm" />
          </div>

          <Button size="sm" className="rounded-md px-5"
            disabled={!personaId || !name.trim() || createFromPersona.isPending}
            onClick={() => createFromPersona.mutate({
              personaId: Number(personaId),
              name: name.trim(),
              description: description.trim() || undefined,
              tags: parseTags(tags),
            })}>
            {createFromPersona.isPending ? t("common.creating") : t("settings.templates.create")}
          </Button>
        </div>
      </section>

      <section className="surface p-5 sm:p-6">
        <SectionHeader note={t("settings.templates.importNote")} title={t("settings.templates.importTitle")} />
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("settings.templates.importHint")}
          </p>
          <input ref={importInputRef} type="file" accept="application/json,.json"
            onChange={handleImportFile} className="hidden" />
          <Button size="sm" variant="outline" className="rounded-md px-5 bg-transparent"
            disabled={importTemplate.isPending}
            onClick={() => importInputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" />
            {importTemplate.isPending ? t("settings.templates.importing") : t("settings.templates.importChoose")}
          </Button>
        </div>
      </section>
    </div>
  );
}

// ─── INSTALL THE APP ─────────────────────────────────────────────────────────

function InstallAppSection() {
  const { t } = useLocale();
  const [available, setAvailable] = useState(isInstallAvailable());
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const unsubscribe = onInstallAvailabilityChange(setAvailable);
    return () => { unsubscribe(); };
  }, []);

  if (!available) return null;

  async function handleInstall() {
    setInstalling(true);
    const accepted = await promptInstall();
    setInstalling(false);
    if (!accepted) toast.error(t("settings.data.installRejected"));
  }

  return (
    <section className="surface p-5 sm:p-6">
      <SectionHeader note={t("settings.data.installNote")} title={t("settings.data.installTitle")} />
      <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
        {t("settings.data.installDescription")}
      </p>
      <Button size="sm" className="rounded-md px-5" disabled={installing} onClick={handleInstall}>
        <MonitorDown className="w-3.5 h-3.5" />
        {installing ? t("settings.data.installing") : t("settings.data.installTitle")}
      </Button>
    </section>
  );
}

// ─── MAIN SETTINGS PAGE ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<TabKey>("profile");

  if (!user) return <PageLoader />;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")}
            className="app-nav-back -ml-1 gap-1">
            <ArrowLeft className="w-4 h-4" /><span className="text-sm">{t("settings.page.back")}</span>
          </button>
          <div className="app-nav-divider" />
          <div className="app-nav-spacer" />
        </div>
      </header>

      <main className="container page-main max-w-3xl">
        <div className="mb-8">
          <p className="kicker kicker-accent mb-3">{t("settings.page.kicker")}</p>
          <h1 className="page-title">{t("settings.title")}</h1>
          <p className="text-sm text-muted-foreground mt-2.5 leading-relaxed">
            {t("settings.page.intro")}
          </p>
        </div>

        {/* Tab Navigation · 发丝线下划线页签

            It is a tab list: the active tab used to be signalled only
            by a coloured underline, so a screen-reader user could not
            tell which of the seven sections was open. */}
        <div role="tablist" aria-label={t("settings.title")}
          className="flex gap-1 mb-7 border-b border-border overflow-x-auto scrollbar-hide">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              role="tab"
              id={`settings-tab-${tab.key}`}
              aria-selected={activeTab === tab.key}
              aria-controls={`settings-panel-${tab.key}`}
              tabIndex={activeTab === tab.key ? 0 : -1}
              className={cn(
                "px-3 sm:px-4 py-2.5 -mb-px text-sm border-b-2 transition-colors flex-shrink-0",
                activeTab === tab.key
                  ? "border-cinnabar text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}>
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <motion.div key={activeTab}
          role="tabpanel"
          id={`settings-panel-${activeTab}`}
          aria-labelledby={`settings-tab-${activeTab}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}>
          {activeTab === "profile" && <ProfileTab />}
          {activeTab === "ai" && <AISettingsTab />}
          {activeTab === "wechat" && <WeChatTab />}
          {activeTab === "channels" && <ChannelsTab onOpenTab={setActiveTab} />}
          {activeTab === "sources" && <DataSourcesTab />}
          {activeTab === "templates" && <TemplateLibraryTab />}
          {activeTab === "data" && <DataManagementTab />}
        </motion.div>
      </main>
    </div>
  );
}
