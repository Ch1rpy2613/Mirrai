import { Suspense, lazy } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import PageLoader from "@/components/PageLoader";

const Lobby = lazy(() => import("./Lobby"));
const Landing = lazy(() => import("./Landing"));

export default function HomePage() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  return (
    <Suspense fallback={<PageLoader />}>
      {isAuthenticated ? <Lobby /> : <Landing />}
    </Suspense>
  );
}
