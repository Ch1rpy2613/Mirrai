import { useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Check, KeyRound, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/contexts/LocaleContext";

type Step = "provider" | "persona" | "done";

/**
 * First-run wizard.
 *
 * A fresh instance has two obvious gaps: no AI provider is configured, and
 * no persona exists. This walks the user through both, one step at a time.
 */
export default function Onboarding() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { t } = useLocale();

  const [step, setStep] = useState<Step>("provider");
  const [providerName, setProviderName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

  const [personaName, setPersonaName] = useState("");
  const [relationshipDesc, setRelationshipDesc] = useState("");
  const [togetherFrom, setTogetherFrom] = useState("");

  const setup = trpc.setup.useQuery(undefined, { enabled: !authLoading });
  const providers = trpc.llmConfig.listProviders.useQuery(undefined, { enabled: isAuthenticated });
  const upsertConfig = trpc.llmConfig.upsert.useMutation();
  const setDefault = trpc.llmConfig.setDefault.useMutation();
  const createPersona = trpc.persona.create.useMutation();

  if (authLoading || setup.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // A provider configured in the environment needs no key from the user.
  if (setup.data?.hasLlmProvider && step === "provider") {
    setStep("persona");
  }

  const handleSaveProvider = async () => {
    if (!providerName) {
      toast.error(t("onboarding.providerRequired"));
      return;
    }
    try {
      await upsertConfig.mutateAsync({
        providerName,
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
        model: model || undefined,
      });
      await setDefault.mutateAsync({ providerName });
      toast.success(t("onboarding.providerSaved"));
      setStep("persona");
    } catch (e: any) {
      toast.error(t("onboarding.saveFailed", { message: e?.message ?? t("errors.unknown") }));
    }
  };

  const handleCreatePersona = async () => {
    if (!personaName.trim()) {
      toast.error(t("onboarding.nameRequired"));
      return;
    }
    try {
      const id = await createPersona.mutateAsync({
        name: personaName.trim(),
        relationshipDesc: relationshipDesc.trim() || undefined,
        togetherFrom: togetherFrom.trim() || undefined,
      });
      toast.success(t("onboarding.created"));
      setStep("done");
      navigate(`/upload/${id}`);
    } catch (e: any) {
      toast.error(t("onboarding.createFailed", { message: e?.message ?? t("errors.unknown") }));
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary mb-4">
            <Sparkles className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground mb-2">
            {step === "provider" ? t("onboarding.title") : step === "persona" ? t("onboarding.titlePersona") : t("onboarding.titleDone")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {step === "provider" && t("onboarding.subtitleProvider")}
            {step === "persona" && t("onboarding.subtitlePersona")}
            {step === "done" && t("onboarding.subtitleDone")}
          </p>
        </div>

        {step === "provider" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="provider">{t("onboarding.providerLabel")}</Label>
              <select
                id="provider"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                className="w-full h-11 px-3 rounded-md border border-border bg-muted/40 text-foreground"
              >
                <option value="">{t("onboarding.selectPlaceholder")}</option>
                {(providers.data ?? []).map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                    {p.configured ? t("onboarding.configured") : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="baseUrl">{t("onboarding.baseUrlLabel")}</Label>
                <Input id="baseUrl" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">{t("onboarding.modelLabel")}</Label>
                <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" />
              </div>
            </div>

            <Button onClick={handleSaveProvider} disabled={upsertConfig.isPending || setDefault.isPending} className="w-full">
              {upsertConfig.isPending || setDefault.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <KeyRound className="w-4 h-4 mr-2" />
              )}
              {t("onboarding.saveAndContinue")}
            </Button>

            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => setStep("persona")}
            >
              {t("onboarding.skip")}
            </Button>
          </div>
        )}

        {step === "persona" && (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="personaName">{t("onboarding.personaNameLabel")}</Label>
              <Input
                id="personaName"
                value={personaName}
                onChange={(e) => setPersonaName(e.target.value)}
                placeholder={t("onboarding.personaNamePlaceholder")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="relationshipDesc">{t("onboarding.relationshipLabel")}</Label>
              <Textarea
                id="relationshipDesc"
                value={relationshipDesc}
                onChange={(e) => setRelationshipDesc(e.target.value)}
                placeholder={t("onboarding.relationshipPlaceholder")}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="togetherFrom">{t("onboarding.togetherFromLabel")}</Label>
              <Input
                id="togetherFrom"
                value={togetherFrom}
                onChange={(e) => setTogetherFrom(e.target.value)}
                placeholder="2021-05"
              />
            </div>

            <Button onClick={handleCreatePersona} disabled={createPersona.isPending} className="w-full">
              {createPersona.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              {t("onboarding.createAndUpload")}
            </Button>

            {/* Not everyone has chat logs to upload. The questionnaire asks
                the same questions and builds the same persona. */}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => navigate("/persona/new/questionnaire")}
            >
              {t("onboarding.useQuestionnaire")}
            </Button>

            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => navigate("/")}
            >
              {t("onboarding.skipLater")}
            </Button>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 text-primary">
              <Check className="w-6 h-6" />
            </div>
            <Button className="w-full" onClick={() => navigate("/")}>
              {t("onboarding.toLobby")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
