import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import PageLoader from "./components/PageLoader";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider } from "./contexts/LocaleContext";
import HomePage from "./pages/HomePage";

const Login = lazy(() => import("./pages/Login"));
const Settings = lazy(() => import("./pages/Settings"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Diary = lazy(() => import("./pages/Diary"));
const PersonaEdit = lazy(() => import("./pages/PersonaEdit"));
const Upload = lazy(() => import("./pages/Upload"));
const Chat = lazy(() => import("./pages/Chat"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/login" component={Login} />
        <Route path="/settings" component={Settings} />
        <Route path="/analytics" component={Analytics} />
        <Route path="/diary" component={Diary} />
        <Route path="/persona/:id/edit" component={PersonaEdit} />
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
            <Toaster />
            <Router />
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
