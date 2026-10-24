import { Suspense, lazy } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import PageLoader from "@/components/PageLoader";

const Lobby = lazy(() => import("./Lobby"));
const Landing = lazy(() => import("./Landing"));

export default function HomePage() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  // A public probe tells us whether an AI provider is configured at all.
  const setup = trpc.setup.useQuery(undefined, { enabled: !loading });

  if (loading) {
    return <PageLoader />;
  }

  // Without a provider the chat cannot work, so send the user to the
  // first-run wizard instead of an empty dashboard.
  if (isAuthenticated && setup.data && !setup.data.hasLlmProvider) {
    navigate("/onboarding", { replace: true });
    return <PageLoader />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      {isAuthenticated ? <Lobby /> : <Landing />}
    </Suspense>
  );
}
