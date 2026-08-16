import { useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/contexts/LocaleContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Wordmark } from "@/components/Wordmark";
import {
  Globe, ChevronDown, ArrowRight, ChevronUp, Moon, Sun,
} from "lucide-react";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.1 } },
};

/* ─── Nav ─── */

function LandingNav() {
  const [, navigate] = useLocation();
  const { t, locale, setLocale } = useLocale();
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 app-header">
      <div className="container app-nav">
        <div className="app-nav-brand">
          <Wordmark size="text-lg" />
        </div>
        <div className="app-nav-spacer" />
        <div className="app-nav-actions">
          {toggleTheme && (
            <button onClick={toggleTheme} className="app-nav-icon" aria-label="切换主题">
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
            className="app-nav-back gap-1.5 text-sm"
            aria-label={t.nav.language}
          >
            <Globe className="w-4 h-4" />
            <span className="hidden sm:inline">{t.nav.language}</span>
          </button>
          <div className="app-nav-divider" />
          <Button variant="ghost" size="sm" onClick={() => navigate("/login")} className="text-sm">
            {t.nav.login}
          </Button>
          <Button size="sm" onClick={() => navigate("/login")} className="hidden sm:inline-flex text-sm rounded-md px-4">
            {t.nav.register}
          </Button>
        </div>
      </div>
    </nav>
  );
}

/* ─── Hero ─── */

function HeroSection() {
  const [, navigate] = useLocation();
  const { t } = useLocale();

  return (
    <section className="relative min-h-[92svh] flex items-center pt-20 pb-16">
      <motion.div
        className="container"
        initial="hidden"
        animate="visible"
        variants={stagger}
      >
        <div className="max-w-3xl">
          <motion.p variants={fadeUp} className="kicker kicker-accent mb-8">
            情感记忆操作系统
          </motion.p>

          <motion.h1
            variants={fadeUp}
            className="font-display text-5xl sm:text-6xl lg:text-7xl font-semibold text-foreground leading-[1.2] mb-8"
          >
            {t.hero.tagline}
          </motion.h1>

          <motion.p variants={fadeUp} className="text-lg text-muted-foreground max-w-xl mb-4 leading-relaxed">
            {t.hero.subtitle}
          </motion.p>

          <motion.div variants={fadeUp} className="rule w-16 my-10" />

          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-3">
            <Button size="lg" onClick={() => navigate("/login")} className="rounded-md px-8 h-11 text-[0.9375rem] gap-2">
              {t.hero.cta}
              <ArrowRight className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => document.getElementById("story")?.scrollIntoView({ behavior: "smooth" })}
              className="rounded-md px-8 h-11 text-[0.9375rem] gap-2 bg-transparent"
            >
              {t.hero.ctaSecondary}
            </Button>
          </motion.div>
        </div>
      </motion.div>

      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        animate={{ y: [0, 6, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <ChevronDown className="w-4 h-4 text-muted-foreground/50" />
      </motion.div>
    </section>
  );
}

/* ─── Stats ─── */
function StatsSection() {
  const { t } = useLocale();

  return (
    <section className="border-y border-border">
      <div className="container">
        <motion.div
          className="grid grid-cols-2 md:grid-cols-4"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.stats.items.map((s, i) => (
            <motion.div
              key={s.value}
              variants={fadeUp}
              className={`py-10 pr-4 ${i % 2 === 1 ? "pl-6 border-l border-border" : ""} ${i >= 2 ? "border-t border-border md:border-t-0" : ""} ${i > 0 ? "md:border-l md:border-border md:pl-10" : ""}`}
            >
              <div className="font-display text-3xl font-semibold text-foreground mb-1">{s.value}</div>
              <div className="text-sm text-muted-foreground leading-relaxed">{s.label}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Section Heading ─── */
function SectionHeading({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return (
    <motion.div
      className="mb-14"
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-100px" }}
      variants={stagger}
    >
      <motion.div variants={fadeUp} className="font-display text-sm text-cinnabar mb-3">{index}</motion.div>
      <motion.h2 variants={fadeUp} className="font-display text-3xl sm:text-4xl font-semibold text-foreground mb-3">
        {title}
      </motion.h2>
      <motion.p variants={fadeUp} className="text-muted-foreground max-w-md">
        {subtitle}
      </motion.p>
    </motion.div>
  );
}

/* ─── Story ─── */
function StorySection() {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);

  return (
    <section id="story" className="py-24 sm:py-28">
      <div className="container">
        <motion.div
          className="max-w-2xl"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={stagger}
        >
          <motion.div variants={fadeUp} className="font-display text-sm text-cinnabar mb-3">前序</motion.div>
          <motion.h2 variants={fadeUp} className="font-display text-3xl sm:text-4xl font-semibold text-foreground mb-3">
            {t.story.title}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground mb-10">
            {t.story.subtitle}
          </motion.p>

          <motion.blockquote variants={fadeUp} className="border-l-2 border-cinnabar/50 pl-6 sm:pl-8">
            <p className="letter-prose text-lg sm:text-xl text-foreground/90">
              {t.story.quote}
            </p>
          </motion.blockquote>

          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.45, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="letter-prose text-foreground/80 mt-10">
                  {t.story.body.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                  <hr className="rule my-10" />
                  <p className="text-lg text-foreground">{t.story.closing}</p>
                  <p className="text-sm font-sans text-muted-foreground text-right">
                    {t.story.signature}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div variants={fadeUp} className="mt-8">
            <Button
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              className="gap-1.5 px-0 text-cinnabar hover:text-cinnabar hover:bg-transparent"
            >
              {expanded ? t.story.collapse : t.story.readMore}
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Features · 目录式编号列表 ─── */
function FeaturesSection() {
  const { t } = useLocale();

  return (
    <section id="features" className="py-24 sm:py-28 border-t border-border">
      <div className="container">
        <SectionHeading index="01" title={t.features.title} subtitle={t.features.subtitle} />

        <motion.div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-0 max-w-6xl"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.features.items.map((item, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              className="border-t border-border py-7"
            >
              <div className="font-display text-sm text-muted-foreground mb-3">
                {String(i + 1).padStart(2, "0")}
              </div>
              <h3 className="font-display text-lg font-semibold text-foreground mb-2">{item.title}</h3>
              <p className="text-muted-foreground leading-relaxed text-[0.9375rem]">{item.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ─── How It Works ─── */
function HowItWorksSection() {
  const { t } = useLocale();

  return (
    <section id="how-it-works" className="py-24 sm:py-28 border-t border-border">
      <div className="container">
        <SectionHeading index="02" title={t.howItWorks.title} subtitle={t.howItWorks.subtitle} />

        <motion.div
          className="max-w-3xl"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.howItWorks.steps.map((step, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              className="flex gap-6 sm:gap-10 py-8 border-t border-border last:border-b"
            >
              <div className="font-display text-2xl font-semibold text-cinnabar w-10 shrink-0 pt-0.5">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold text-foreground mb-1.5">{step.title}</h3>
                <p className="text-muted-foreground leading-relaxed text-[0.9375rem]">{step.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Tech ─── */
function TechSection() {
  const { t } = useLocale();

  return (
    <section id="tech" className="py-24 sm:py-28 border-t border-border">
      <div className="container">
        <SectionHeading index="03" title={t.tech.title} subtitle={t.tech.subtitle} />

        <motion.div
          className="max-w-4xl"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          <motion.div variants={fadeUp} className="flex flex-wrap gap-x-8 gap-y-3 mb-14 pb-8 border-b border-border">
            {t.tech.stack.map((item, i) => (
              <div key={i} className="flex items-baseline gap-2">
                <span className="font-display font-semibold text-foreground">{item.name}</span>
                <span className="text-sm text-muted-foreground">{item.desc}</span>
              </div>
            ))}
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-8">
            {t.tech.highlights.map((item, i) => (
              <motion.div key={i} variants={fadeUp}>
                <h3 className="font-display text-base font-semibold text-foreground mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Testimonials ─── */
function TestimonialsSection() {
  const { t } = useLocale();

  return (
    <section id="testimonials" className="py-24 sm:py-28 border-t border-border">
      <div className="container">
        <SectionHeading index="04" title={t.testimonials.title} subtitle={t.testimonials.subtitle} />

        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-10 max-w-6xl"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          {t.testimonials.items.map((item, i) => (
            <motion.figure key={i} variants={fadeUp} className="border-t border-border pt-7 flex flex-col">
              <blockquote className="letter-prose text-[0.9375rem] text-foreground/90 flex-1">
                {item.quote}
              </blockquote>
              <figcaption className="mt-6 text-sm">
                <span className="font-display font-semibold text-foreground">{item.author}</span>
                <span className="text-muted-foreground"> · {item.role}</span>
              </figcaption>
            </motion.figure>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ─── CTA ─── */

function CTASection() {
  const [, navigate] = useLocation();
  const { t } = useLocale();

  return (
    <section className="py-24 sm:py-32 border-t border-border">
      <div className="container">
        <motion.div
          className="max-w-2xl"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={stagger}
        >
          <motion.h2 variants={fadeUp} className="font-display text-3xl sm:text-5xl font-semibold text-foreground mb-5 leading-[1.25]">
            {t.hero.tagline}
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground text-lg mb-10">
            {t.hero.subtitle}
          </motion.p>
          <motion.div variants={fadeUp}>
            <Button size="lg" onClick={() => navigate("/login")} className="rounded-md px-10 h-11 text-[0.9375rem] gap-2">
              {t.hero.cta}
              <ArrowRight className="w-4 h-4" />
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* ─── Footer ─── */

function LandingFooter() {
  const { t } = useLocale();

  return (
    <footer className="border-t border-border">
      <div className="container py-14">
        <div className="flex flex-col md:flex-row justify-between gap-10">
          <div>
            <Wordmark size="text-lg" />
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed mt-3">{t.footer.tagline}</p>
          </div>

          <div className="flex gap-16 sm:gap-20">
            <div>
              <h4 className="text-sm font-medium text-foreground mb-4">{t.footer.product}</h4>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">{t.footer.features}</a></li>
                <li><a href="#how-it-works" className="hover:text-foreground transition-colors">{t.footer.how}</a></li>
                <li><a href="#tech" className="hover:text-foreground transition-colors">{t.footer.tech}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-medium text-foreground mb-4">{t.footer.company}</h4>
              <ul className="space-y-2.5 text-sm text-muted-foreground">
                <li><a href="#story" className="hover:text-foreground transition-colors">{t.footer.about}</a></li>
              </ul>
            </div>
          </div>
        </div>

        <hr className="rule mt-12 mb-6" />
        <div className="text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} {t.footer.copyright}
        </div>
      </div>
    </footer>
  );
}

/* ─── Page ─── */

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <LandingNav />
      <HeroSection />
      <StatsSection />
      <StorySection />
      <FeaturesSection />
      <HowItWorksSection />
      <TechSection />
      <TestimonialsSection />
      <CTASection />
      <LandingFooter />
    </div>
  );
}
