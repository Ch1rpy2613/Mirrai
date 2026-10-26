import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/Wordmark";
import { trpc } from "@/lib/trpc";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

export default function Login() {
  const [location, navigate] = useLocation();
  const { t, locale } = useLocale();
  const utils = trpc.useUtils();
  /**
   * Which form is shown.
   *
   * The landing page's "Sign up" button said one thing and did another:
   * it opened the sign-in form. So a reader who chose to register had
   * to find the small "create an account" link at the bottom of the
   * sign-in form to get what they asked for.
   *
   * The page reads it from the address now, so the button can say
   * "register" and mean it.
   */
  const [isRegister, setIsRegister] = useState(
    () => new URLSearchParams(location.split("?")[1] ?? "").get("mode") === "register",
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // The server's own words have to be in the language of the
          // person reading them: the sign-in screen is where the
          // wording matters most, and it used to answer in English
          // whatever the reader's language was.
          "x-mirrai-locale": locale,
        },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t("auth.failed"));
        return;
      }

      // invalidate() only marks the query stale — it does not refetch a
      // query nobody is subscribed to, so the next route would still read
      // an empty cache and render the landing page. Refetch instead.
      await utils.auth.me.refetch();
      navigate("/");
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <header className="app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")} className="app-nav-back -ml-1 gap-1" aria-label={t("auth.backHome")}>
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm hidden sm:inline">{t("common.back")}</span>
          </button>
          <div className="app-nav-spacer" />
          <Wordmark />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md animate-fade-in-up">
          <p className="kicker kicker-accent mb-3">{isRegister ? t("auth.newStart") : t("auth.loginTitle")}</p>
          <h1 className="page-title">
            {isRegister ? t("auth.registerTitle") : t("auth.loginToContinue")}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {isRegister ? t("auth.registerTagline") : t("auth.loginTagline")}
          </p>

          <hr className="rule my-8" />

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="kicker">{t("auth.username")}</Label>
              <Input
                id="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t("auth.usernamePlaceholder")}
                className="h-11"
                required
                minLength={2}
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="kicker">{t("auth.password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t("auth.passwordPlaceholder")}
                className="h-11"
                required
                minLength={6}
                autoComplete={isRegister ? "new-password" : "current-password"}
              />
            </div>

            {error && (
              <p className="text-destructive text-sm animate-fade-in" role="alert">{error}</p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 text-[0.9375rem]"
            >
              {loading ? t("auth.processing") : isRegister ? t("auth.register") : t("auth.login")}
            </Button>
          </form>

          <p className="text-muted-foreground text-sm mt-7">
            {isRegister ? t("auth.haveAccount") : t("auth.needAccount")}
            <button
              type="button"
              onClick={() => { setIsRegister(!isRegister); setError(""); }}
              className="text-cinnabar hover:opacity-80 ml-1 font-medium transition-opacity"
            >
              {isRegister ? t("auth.switchToLogin") : t("auth.register")}
            </button>
          </p>

          <p className="text-center text-xs text-muted-subtle mt-12">
            {t("auth.footer")}
          </p>
        </div>
      </main>
    </div>
  );
}
