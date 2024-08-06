import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import {
  Leaf, Globe, Brain, Smartphone, Heart, Shield,
  UserPlus, Upload, MessageCircle, Quote, ChevronDown,
  Sparkles, ArrowRight,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" as const } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.12 } },
};

function LandingNav() {
  const [, navigate] = useLocation();
  const { t, locale, setLocale } = useLocale();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 app-header">
      <div className="container app-nav">
        <div className="app-nav-brand">
          <div className="app-nav-mark">
            <Leaf className="w-5 h-5 text-primary" />
          </div>
          <span className="app-nav-title text-lg tracking-tight">Presence</span>
        </div>
        <div className="app-nav-spacer" />
        <div className="app-nav-actions">
          <button
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="app-nav-back flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm"
          >
            <Globe className="w-4 h-4" />
            <span className="hidden sm:inline">{t.nav.language}</span>
          </button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/login")} className="app-nav-back text-sm">
            {t.nav.login}
          </Button>
          <Button size="sm" onClick={() => navigate("/login")} className="hidden sm:inline-flex text-sm rounded-xl">
            {t.nav.register}
          </Button>
        </div>
      </div>
    </nav>
  );
}

function HeroBackdrop() {
  return (
    <div className="landing-hero-scene" aria-hidden>
      <div className="landing-chat-column left">
        <div className="landing-chat-card">
          <div className="landing-chat-line primary" />
          <div className="landing-chat-line" />
          <div className="landing-chat-line short" />
        </div>
        <div className="landing-chat-card small offset">
          <div className="landing-chat-line" />
          <div className="landing-chat-line primary short" />
        </div>
        <div className="landing-chat-card">
          <div className="landing-chat-line" />
          <div className="landing-chat-line short" />
        </div>
      </div>
      <div className="landing-chat-column right">
        <div className="landing-chat-card small">
          <div className="landing-chat-line primary short" />
          <div className="landing-chat-line" />
        </div>
        <div className="landing-chat-card offset">
          <div className="landing-chat-line" />
          <div className="landing-chat-line" />
          <div className="landing-chat-line primary short" />
        </div>
        <div className="landing-chat-card small">
          <div className="landing-chat-line" />
          <div className="landing-chat-line short" />
        </div>
      </div>
    </div>
  );
}

function HeroSection() {
  const [, navigate] = useLocation();
  const { t } = useLocale();

  return (
    <section className="relative min-h-[92svh] flex items-center justify-center overflow-hidden pt-24 pb-16">
      <HeroBackdrop />
      <div className="landing-hero-glow" />

      <motion.div
        className="relative z-10 text-center px-4 max-w-3xl mx-auto"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        <motion.div variants={fadeUp} className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-8">
            <Sparkles className="w-4 h-4" />
            AI-Powered Emotional Companion
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="mb-6 inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10">
          <Leaf className="w-10 h-10 text-primary animate-float" />
        </motion.div>

        <motion.h1
          variants={fadeUp}
          className="text-5xl sm:text-6xl lg:text-7xl font-bold text-foreground tracking-tight mb-6 leading-tight"
        >
          {t.hero.tagline}
        </motion.h1>

        <motion.p variants={fadeUp} className="text-lg sm:text-xl text-muted-foreground max-w-xl mx-auto mb-10 leading-relaxed">
          {t.hero.subtitle}
        </motion.p>

        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
          <Button size="lg" onClick={() => navigate("/login")} className="w-full sm:w-auto rounded-xl px-8 h-12 text-base gap-2">
            {t.hero.cta}
            <ArrowRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
            className="w-full sm:w-auto rounded-xl px-8 h-12 text-base gap-2"
          >
            {t.hero.ctaSecondary}
            <ChevronDown className="w-4 h-4" />
          </Button>
        </motion.div>
      </motion.div>

      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        animate={{ y: [0, 8, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <ChevronDown className="w-6 h-6 text-muted-foreground/40" />
      </motion.div>
    </section>
  );
}

const featureIcons = [Brain, Smartphone, Heart, Shield];

function FeaturesSection() {
  const { t } = useLocale();

  return (
    <section id="features" className="landing-section">
      <div className="container">
        <motion.div
          className="text-center mb-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            {t.features.title}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground text-lg max-w-md mx-auto">
            {t.features.subtitle}
          </motion.p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.features.items.map((item, i) => {
            const Icon = featureIcons[i];
            return (
              <motion.div key={i} variants={fadeUp} className="warm-card p-8 group hover:shadow-lg transition-shadow">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-5 group-hover:bg-primary/15 transition-colors">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">{item.title}</h3>
                <p className="text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

const stepIcons = [UserPlus, Upload, MessageCircle];

function HowItWorksSection() {
  const { t } = useLocale();

  return (
    <section id="how-it-works" className="landing-section bg-muted/30">
      <div className="container">
        <motion.div
          className="text-center mb-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            {t.howItWorks.title}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground text-lg max-w-md mx-auto">
            {t.howItWorks.subtitle}
          </motion.p>
        </motion.div>

        <motion.div
          className="flex flex-col md:flex-row items-start justify-center gap-8 md:gap-4 max-w-4xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.howItWorks.steps.map((step, i) => {
            const Icon = stepIcons[i];
            return (
              <motion.div key={i} variants={fadeUp} className="flex-1 text-center relative">
                {i < 2 && (
                  <div className="hidden md:block absolute top-10 left-[calc(50%+40px)] w-[calc(100%-80px)] border-t-2 border-dashed border-primary/20" />
                )}
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-5 relative">
                  <Icon className="w-8 h-8 text-primary" />
                  <span className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mx-auto">{step.desc}</p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

function StatsSection() {
  const { t } = useLocale();
  const stats = [
    { value: "10K+", label: t.stats.users },
    { value: "50K+", label: t.stats.personas },
    { value: "2M+", label: t.stats.messages },
    { value: "98%", label: t.stats.satisfaction },
  ];

  return (
    <section className="py-16">
      <div className="container">
        <motion.div
          className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-3xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {stats.map((s, i) => (
            <motion.div key={i} variants={fadeUp} className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-primary mb-1">{s.value}</div>
              <div className="text-sm text-muted-foreground">{s.label}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function TestimonialsSection() {
  const { t } = useLocale();

  return (
    <section id="testimonials" className="landing-section bg-primary/5">
      <div className="container">
        <motion.div
          className="text-center mb-16"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            {t.testimonials.title}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground text-lg max-w-md mx-auto">
            {t.testimonials.subtitle}
          </motion.p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.testimonials.items.map((item, i) => (
            <motion.div key={i} variants={fadeUp} className="warm-card p-8 relative">
              <Quote className="w-8 h-8 text-primary/15 absolute top-6 right-6" />
              <p className="text-foreground leading-relaxed mb-6 relative z-10">"{item.quote}"</p>
              <div>
                <div className="font-medium text-foreground">{item.author}</div>
                <div className="text-sm text-muted-foreground">{item.role}</div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function CTASection() {
  const [, navigate] = useLocation();
  const { t } = useLocale();

  return (
    <section className="landing-section">
      <div className="container">
        <motion.div
          className="text-center max-w-2xl mx-auto"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          <motion.div variants={fadeUp} className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-6">
            <Leaf className="w-8 h-8 text-primary" />
          </motion.div>
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            {t.hero.tagline}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground text-lg mb-8">
            {t.hero.subtitle}
          </motion.p>
          <motion.div variants={fadeUp}>
            <Button size="lg" onClick={() => navigate("/login")} className="rounded-xl px-10 h-12 text-base gap-2">
              {t.hero.cta}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function LandingFooter() {
  const { t } = useLocale();

  return (
    <footer className="border-t border-border bg-background">
      <div className="container py-12">
        <div className="flex flex-col md:flex-row justify-between gap-8">
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                <Leaf className="w-4 h-4 text-primary" />
              </div>
              <span className="text-base font-semibold text-foreground">Presence</span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs">{t.footer.tagline}</p>
          </div>

          <div className="flex gap-16">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">{t.footer.product}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">{t.footer.features}</a></li>
                <li><a href="#how-it-works" className="hover:text-foreground transition-colors">{t.footer.pricing}</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">{t.footer.changelog}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground mb-3">{t.footer.company}</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#" className="hover:text-foreground transition-colors">{t.footer.about}</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">{t.footer.privacy}</a></li>
                <li><a href="#" className="hover:text-foreground transition-colors">{t.footer.terms}</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} {t.footer.copyright}
        </div>
      </div>
    </footer>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <LandingNav />
      <HeroSection />
      <StatsSection />
      <FeaturesSection />
      <HowItWorksSection />
      <TestimonialsSection />
      <CTASection />
      <LandingFooter />
    </div>
  );
}
