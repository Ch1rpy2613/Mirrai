import { Suspense, lazy, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import PageLoader from "@/components/PageLoader";
import { onboardingDismissed } from "@/lib/onboarding";

const Lobby = lazy(() => import("./Lobby"));
const Landing = lazy(() => import("./Landing"));


export default function HomePage() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  // A public probe tells us whether an AI provider is configured at all.
  const setup = trpc.setup.useQuery(undefined, { enabled: !loading });

  // Whether there is a provider to chat with.
  //
  // The instance's environment can have none while this user has one of
  // their own — the key they typed into the settings. The probe used to
  // answer about the environment only, so such a user was sent to the
  // first-run wizard on every visit to the front page, and the wizard
  // has no way out: it finishes by sending them back here.
  const hasProvider =
    Boolean(setup.data?.hasLlmProvider) || Boolean(setup.data?.hasUserProvider);

  useEffect(() => {
    // Without a provider the chat cannot work, so send the user to the
    // first-run wizard instead of an empty dashboard.
    //
    // Unless they have already been sent there and left it — the
    // wizard's "skip" used to lead straight back here, and here back to
    // the wizard, for ever: a user who has not configured a provider
    // yet, or who wants to use their own key later, was trapped in the
    // loop with no explanation.
    if (loading) return;
    if (!isAuthenticated) return;
    if (!setup.data) return;
    if (hasProvider) return;
    if (onboardingDismissed()) return;
    navigate("/onboarding", { replace: true });
  }, [loading, isAuthenticated, setup.data, hasProvider, navigate]);

  if (loading) {
    return <PageLoader />;
  }

  // The wizard is on its way; nothing to show yet.
  if (isAuthenticated && setup.data && !hasProvider && !onboardingDismissed()) {
    return <PageLoader />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      {isAuthenticated ? <Lobby /> : <Landing />}
    </Suspense>
  );
}
