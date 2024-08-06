import { useAuth } from "@/_core/hooks/useAuth";
import { Leaf } from "lucide-react";
import Lobby from "./Lobby";
import Landing from "./Landing";

export default function HomePage() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center animate-pulse-soft">
          <Leaf className="w-4 h-4 text-primary" />
        </div>
      </div>
    );
  }

  return isAuthenticated ? <Lobby /> : <Landing />;
}
