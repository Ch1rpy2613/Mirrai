import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/Wordmark";
import { trpc } from "@/lib/trpc";
import { ArrowLeft } from "lucide-react";

export default function Login() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [isRegister, setIsRegister] = useState(false);
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "操作失败");
        return;
      }

      await utils.auth.me.invalidate();
      navigate("/");
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <header className="app-header">
        <div className="container app-nav">
          <button onClick={() => navigate("/")} className="app-nav-back -ml-1 gap-1" aria-label="返回首页">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm hidden sm:inline">返回</span>
          </button>
          <div className="app-nav-spacer" />
          <Wordmark />
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md animate-fade-in-up">
          <p className="kicker kicker-accent mb-3">{isRegister ? "新的开始" : "欢迎回来"}</p>
          <h1 className="font-display text-2xl sm:text-3xl font-semibold text-foreground">
            {isRegister ? "创建账号" : "登录以继续"}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">
            {isRegister ? "把一段关系，安放在这里。" : "你的分身还在书房里等你。"}
          </p>

          <hr className="rule my-8" />

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="kicker">用户名</Label>
              <Input
                id="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="输入用户名"
                className="h-11"
                required
                minLength={2}
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="kicker">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="输入密码"
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
              {loading ? "处理中..." : isRegister ? "注册" : "登录"}
            </Button>
          </form>

          <p className="text-muted-foreground text-sm mt-7">
            {isRegister ? "已有账号？" : "没有账号？"}
            <button
              type="button"
              onClick={() => { setIsRegister(!isRegister); setError(""); }}
              className="text-cinnabar hover:opacity-80 ml-1 font-medium transition-opacity"
            >
              {isRegister ? "去登录" : "注册"}
            </button>
          </p>

          <p className="text-center text-xs text-muted-foreground/80 mt-12">
            每一段记忆，都值得被妥善安放
          </p>
        </div>
      </main>
    </div>
  );
}
