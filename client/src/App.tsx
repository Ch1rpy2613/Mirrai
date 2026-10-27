import { Suspense, lazy } from "react";
import { MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { useRouteFocus } from "./lib/route-focus";
import ErrorBoundary from "./components/ErrorBoundary";
import PageLoader from "./components/PageLoader";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider } from "./contexts/LocaleContext";
import HomePage from "./pages/HomePage";
import TimezoneSync from "./components/TimezoneSync";
import CommandPalette from "./components/CommandPalette";

const Login = lazy(() => import("./pages/Login"));
const Settings = lazy(() => import("./pages/Settings"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Diary = lazy(() => import("./pages/Diary"));
const PersonaEdit = lazy(() => import("./pages/PersonaEdit"));
const PersonaProfile = lazy(() => import("./pages/PersonaProfile"));
const Graduation = lazy(() => import("./pages/Graduation"));
const Upload = lazy(() => import("./pages/Upload"));
const Chat = lazy(() => import("./pages/Chat"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Questionnaire = lazy(() => import("./pages/Questionnaire"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Router() {
  const [location] = useLocation();
  /**
   * The focus follows the route.
   *
   * A client-side navigation replaces the page without moving the
   * focus: so a keyboard user who pressed a link is left with the focus
   * on a link that is not there any more, and a screen reader is still
   * reading the page they came from.
   */
  useRouteFocus(location);

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/onboarding" component={Onboarding} />
        <Route path="/persona/new/questionnaire" component={Questionnaire} />
        <Route path="/login" component={Login} />
        <Route path="/settings" component={Settings} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/diary" component={Diary} />
        <Route path="/persona/:id/edit" component={PersonaEdit} />
        <Route path="/persona/:id/profile" component={PersonaProfile} />
        <Route path="/persona/:id/graduation" component={Graduation} />
        <Route path="/upload/:id" component={Upload} />
        <Route path="/chat/:id" component={Chat} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <LocaleProvider>
          <TooltipProvider>
            {/* The page transitions follow the operating system's motion
                setting. Framer-motion's own default is "never" — it
                does not consult the system at all — so a user with
                vestibular sensitivity got full sliding and fading
                transitions even though they had asked the system to
                reduce motion. The stylesheet neutralises the CSS
                animations, which made it look handled. */}
            <MotionConfig reducedMotion="user">
              <Toaster />
              <TimezoneSync />
              <CommandPalette />
              <Router />
            </MotionConfig>
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
