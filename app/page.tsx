import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { LandingContactForm } from "@/app/_components/landing-contact-form";

const pageTitle = "PilotDesk | Grow & Manage Your Coaching Institute";
const pageDescription =
  "Get more admissions and manage mock tests, attendance, fees, assignments, parents and more with PilotDesk.";

export async function generateMetadata(): Promise<Metadata> {
  const incomingHeaders = await headers();
  const host = incomingHeaders.get("host") || "pilotdesk.in";
  const protocol = incomingHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const image = `${origin}/og.png`;

  return {
    title: pageTitle,
    description: pageDescription,
    alternates: { canonical: `${origin}/` },
    openGraph: {
      type: "website",
      url: `${origin}/`,
      siteName: "PilotDesk",
      title: pageTitle,
      description: pageDescription,
      images: [{ url: image, width: 1200, height: 630, alt: "PilotDesk institute growth and management platform" }],
    },
    twitter: {
      card: "summary_large_image",
      title: pageTitle,
      description: pageDescription,
      images: [image],
    },
  };
}

const phoneDisplay = "+91 89201 52023";
const phoneHref = "tel:+918920152023";
const whatsappUrl =
  "https://wa.me/918920152023?text=Hi%20PilotDesk%2C%20I%27d%20like%20to%20know%20more%20about%20your%20institute%20growth%20platform.";

const serviceGroups = [
  {
    eyebrow: "Get discovered",
    title: "Turn attention into admissions",
    description: "A practical growth engine that keeps your institute visible and every enquiry moving forward.",
    accent: "violet",
    features: [
      { icon: "📢", title: "Google & Meta Ads", text: "Reach parents and students already looking for the right institute." },
      { icon: "🎨", title: "Promotional Creatives", text: "Campaign-ready images and promotional content that look professional." },
      { icon: "📱", title: "Social & Google Profile", text: "Stay active on social media and keep your Google Business Profile fresh." },
      { icon: "🎯", title: "Lead Management", text: "Capture enquiries, organize follow-ups and reduce missed admissions." },
    ],
  },
  {
    eyebrow: "Teach better",
    title: "Everything your academic team needs",
    description: "Move daily classwork online without making teachers, staff or students learn a complicated system.",
    accent: "blue",
    features: [
      { icon: "📝", title: "Daily Mock Tests", text: "Create consistent practice routines and track student performance." },
      { icon: "📚", title: "Previous Year Questions", text: "Give students easy access to exam-relevant practice material." },
      { icon: "🔔", title: "Latest Exam Updates", text: "Keep students informed about important exam news and deadlines." },
      { icon: "📋", title: "Assignments", text: "Share work, set due dates and keep submissions organized." },
      { icon: "✅", title: "Digital Attendance", text: "Record attendance quickly and make every day easy to review." },
      { icon: "📅", title: "Timetable Management", text: "Plan classes clearly so students and teachers always know what is next." },
    ],
  },
  {
    eyebrow: "Stay connected",
    title: "A smoother experience for every family",
    description: "Give parents clarity, simplify payments and keep your entire institute aligned from one place.",
    accent: "amber",
    features: [
      { icon: "👨‍👩‍👧", title: "Parents Portal", text: "Parents can track attendance, performance, assignments and updates." },
      { icon: "💳", title: "Fees Management", text: "Track payments, pending fees and reminders without messy registers." },
      { icon: "💰", title: "Online Payments", text: "Collect fees through an integrated online payment gateway." },
      { icon: "🆕", title: "Regular Updates", text: "Keep improving with ongoing platform upgrades and new features." },
    ],
  },
];

const steps = [
  { number: "01", title: "Tell us your goals", text: "We learn how your institute attracts students and runs each day." },
  { number: "02", title: "Get your setup", text: "We tailor the platform and growth services around your workflow." },
  { number: "03", title: "Grow with clarity", text: "Your team gets one organized system for leads, classes and families." },
];

export default function Home() {
  return (
    <main id="top" className="min-h-screen bg-[#f6f7fb] text-[#101828] selection:bg-[#dcd8ff]">
      <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-[#f6f7fb]/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
          <a href="#top" className="flex items-center gap-3" aria-label="PilotDesk home">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#6556e8] text-lg font-black text-white shadow-lg shadow-indigo-200">P</span>
            <span className="text-xl font-extrabold tracking-[-0.04em]">PilotDesk</span>
          </a>
          <nav className="hidden items-center gap-7 text-sm font-bold text-slate-600 lg:flex" aria-label="Primary navigation">
            <a className="transition hover:text-[#6556e8]" href="#services">Services</a>
            <a className="transition hover:text-[#6556e8]" href="#how-it-works">How it works</a>
            <a className="transition hover:text-[#6556e8]" href="#contact">Contact</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <a href={phoneHref} className="hidden rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-[#6556e8] sm:inline-flex">Call us</a>
            <Link href="/login" className="rounded-xl bg-[#101828] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#6556e8]">Client sign in</Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden px-5 pb-20 pt-12 sm:px-8 lg:px-10 lg:pb-28 lg:pt-20">
        <div className="absolute left-1/2 top-16 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-indigo-200/55 blur-3xl" />
        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-14 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/80 px-3 py-2 text-xs font-extrabold uppercase tracking-[0.14em] text-[#5949d6] shadow-sm backdrop-blur">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Built for coaching institutes
            </div>
            <h1 className="max-w-3xl text-5xl font-black leading-[1.02] tracking-[-0.055em] text-[#101828] sm:text-6xl lg:text-[4.5rem]">
              Grow your institute. <span className="text-[#6556e8]">Run it smarter.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg font-medium leading-8 text-slate-600 sm:text-xl">
              From getting new admissions to managing every class, PilotDesk brings marketing, mock tests, attendance, fees and parent updates into one simple platform.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href="#contact" className="inline-flex min-h-13 items-center justify-center rounded-2xl bg-[#6556e8] px-6 py-3.5 text-sm font-extrabold text-white shadow-xl shadow-indigo-200 transition hover:-translate-y-0.5 hover:bg-[#5949d6]">Get a free consultation</a>
              <a href={whatsappUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-extrabold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300">
                <span className="text-emerald-500" aria-hidden="true">●</span> WhatsApp us
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-bold text-slate-500">
              <span>✓ One simple platform</span><span>✓ Built for institutes</span><a className="text-slate-700 hover:text-[#6556e8]" href={phoneHref}>{phoneDisplay}</a>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-xl">
            <div className="absolute -inset-5 rotate-2 rounded-[2rem] bg-[#d9d4ff]" />
            <div className="relative rounded-[1.75rem] border border-white/80 bg-white p-4 shadow-[0_30px_80px_rgba(40,42,90,.18)] sm:p-6">
              <div className="mb-5 flex items-center justify-between">
                <div><p className="text-xs font-bold uppercase tracking-[.16em] text-slate-400">This month</p><p className="mt-1 text-lg font-black">Institute overview</p></div>
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700">+24% growth</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[["New leads","184","bg-violet-50 text-violet-700"],["Attendance","92%","bg-blue-50 text-blue-700"],["Fees collected","₹2.4L","bg-emerald-50 text-emerald-700"],["Tests taken","1,248","bg-amber-50 text-amber-700"]].map(([label,value,color]) => (
                  <div key={label} className={`rounded-2xl p-4 ${color}`}><p className="text-xs font-bold opacity-70">{label}</p><p className="mt-2 text-2xl font-black tracking-tight">{value}</p></div>
                ))}
              </div>
              <div className="mt-4 rounded-2xl bg-[#101828] p-5 text-white">
                <div className="flex items-center justify-between"><p className="text-sm font-extrabold">Admissions pipeline</p><p className="text-xs font-bold text-slate-400">Live</p></div>
                <div className="mt-5 flex h-28 items-end gap-2" aria-label="Admissions growth chart">
                  {[35,48,43,66,58,78,88,94].map((height,index) => <span key={index} className="flex-1 rounded-t-md bg-gradient-to-t from-[#6556e8] to-[#a89ffb]" style={{height: `${height}%`}} />)}
                </div>
              </div>
              <div className="absolute -right-3 -top-5 hidden rounded-2xl border border-white bg-white p-3 shadow-xl sm:block">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Follow-ups today</p><p className="mt-1 text-xl font-black text-[#6556e8]">12</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-4 text-center text-xs font-extrabold uppercase tracking-[.14em] text-slate-500 sm:justify-between">
          <span>Marketing that converts</span><span>Smarter daily operations</span><span>Clear parent communication</span><span>Better student outcomes</span>
        </div>
      </section>

      <section id="services" className="scroll-mt-24 px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-extrabold uppercase tracking-[.18em] text-[#6556e8]">One partner. Every growth lever.</p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.045em] text-[#101828] sm:text-5xl">Everything you need to grow and manage your institute</h2>
            <p className="mt-5 text-lg font-medium leading-8 text-slate-600">Practical services on the outside. A powerful operating system on the inside.</p>
          </div>

          <div className="mt-16 space-y-7">
            {serviceGroups.map((group, groupIndex) => (
              <article key={group.title} className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_18px_55px_rgba(16,24,40,.06)]">
                <div className={`grid gap-8 p-6 sm:p-8 lg:grid-cols-[.72fr_1.28fr] lg:p-10 ${groupIndex === 1 ? "lg:grid-cols-[.72fr_1.28fr]" : ""}`}>
                  <div className="flex flex-col justify-between rounded-[1.5rem] bg-[#101828] p-7 text-white">
                    <div>
                      <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#a99fff]">{group.eyebrow}</p>
                      <h3 className="mt-4 text-3xl font-black leading-tight tracking-[-0.035em]">{group.title}</h3>
                      <p className="mt-4 font-medium leading-7 text-slate-300">{group.description}</p>
                    </div>
                    <a href="#contact" className="mt-8 inline-flex items-center gap-2 text-sm font-extrabold text-white">Explore with our team <span aria-hidden="true">→</span></a>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {group.features.map((feature) => (
                      <div key={feature.title} className="group rounded-[1.35rem] border border-slate-200 bg-[#fafbfe] p-5 transition hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg hover:shadow-indigo-100/60">
                        <span className="grid h-11 w-11 place-items-center rounded-xl bg-white text-xl shadow-sm" aria-hidden="true">{feature.icon}</span>
                        <h4 className="mt-4 text-base font-extrabold tracking-[-0.02em] text-slate-900">{feature.title}</h4>
                        <p className="mt-2 text-sm font-medium leading-6 text-slate-600">{feature.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-24 bg-[#101828] px-5 py-20 text-white sm:px-8 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:items-end">
            <div>
              <p className="text-sm font-extrabold uppercase tracking-[.18em] text-[#a99fff]">Simple from day one</p>
              <h2 className="mt-4 text-4xl font-black tracking-[-0.045em] sm:text-5xl">Your growth plan, without the complexity</h2>
            </div>
            <p className="max-w-2xl text-lg font-medium leading-8 text-slate-300 lg:justify-self-end">PilotDesk is more than software. We help you connect the pieces—from your first ad to the parent&apos;s latest fee update.</p>
          </div>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="rounded-[1.5rem] border border-white/10 bg-white/[.06] p-7">
                <p className="text-4xl font-black text-[#8275f2]">{step.number}</p>
                <h3 className="mt-8 text-xl font-extrabold">{step.title}</h3>
                <p className="mt-3 font-medium leading-7 text-slate-300">{step.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="scroll-mt-20 px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
        <div className="mx-auto grid max-w-7xl overflow-hidden rounded-[2rem] bg-[#e9e6ff] shadow-[0_24px_70px_rgba(67,56,150,.14)] lg:grid-cols-[.9fr_1.1fr]">
          <div className="relative overflow-hidden p-7 sm:p-10 lg:p-14">
            <div className="absolute -bottom-32 -left-32 h-80 w-80 rounded-full bg-[#cfc8ff] blur-2xl" />
            <div className="relative">
              <p className="text-sm font-extrabold uppercase tracking-[.18em] text-[#5949d6]">Let&apos;s talk growth</p>
              <h2 className="mt-4 max-w-xl text-4xl font-black tracking-[-0.045em] text-[#101828] sm:text-5xl">Ready to make your institute easier to grow?</h2>
              <p className="mt-5 max-w-lg text-base font-medium leading-7 text-slate-600">Share a few details and our team will contact you for a free, no-pressure consultation.</p>
              <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <a href={phoneHref} className="rounded-2xl bg-white p-5 shadow-sm transition hover:-translate-y-0.5">
                  <span className="text-xl" aria-hidden="true">☎️</span><p className="mt-3 text-xs font-bold uppercase tracking-wider text-slate-400">Call us</p><p className="mt-1 font-extrabold text-slate-900">{phoneDisplay}</p>
                </a>
                <a href={whatsappUrl} target="_blank" rel="noreferrer" className="rounded-2xl bg-[#24a765] p-5 text-white shadow-sm transition hover:-translate-y-0.5">
                  <span className="text-xl" aria-hidden="true">💬</span><p className="mt-3 text-xs font-bold uppercase tracking-wider text-emerald-100">WhatsApp</p><p className="mt-1 font-extrabold">Start a conversation</p>
                </a>
              </div>
            </div>
          </div>
          <div className="bg-white p-6 sm:p-10 lg:p-12">
            <LandingContactForm />
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-5 py-10 sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          <div><a href="#top" className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#6556e8] font-black text-white">P</span><span className="text-lg font-extrabold tracking-tight">PilotDesk</span></a><p className="mt-3 text-sm font-medium text-slate-500">Growth and operations for modern coaching institutes.</p></div>
          <div className="flex flex-wrap items-center gap-5 text-sm font-bold text-slate-600"><a href={phoneHref}>{phoneDisplay}</a><a href={whatsappUrl} target="_blank" rel="noreferrer">WhatsApp</a><Link href="/privacy">Privacy</Link><Link href="/login">Client sign in</Link></div>
        </div>
      </footer>

      <div className="fixed bottom-4 right-4 z-50 flex gap-2 sm:bottom-6 sm:right-6">
        <a href={phoneHref} aria-label={`Call PilotDesk on ${phoneDisplay}`} className="grid h-13 w-13 place-items-center rounded-full bg-[#101828] text-xl text-white shadow-xl transition hover:-translate-y-1">☎</a>
        <a href={whatsappUrl} target="_blank" rel="noreferrer" aria-label="Chat with PilotDesk on WhatsApp" className="grid h-13 w-13 place-items-center rounded-full bg-[#24a765] text-xl text-white shadow-xl transition hover:-translate-y-1">💬</a>
      </div>
    </main>
  );
}
