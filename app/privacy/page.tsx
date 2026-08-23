import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | PilotDesk",
  description: "How PilotDesk handles information submitted through its website and services.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#f6f7fb] px-5 py-10 text-[#101828] sm:px-8 sm:py-16">
      <article className="mx-auto max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_rgba(16,24,40,.07)] sm:p-10 lg:p-14">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-extrabold text-[#6556e8]">← Back to PilotDesk</Link>
        <p className="mt-10 text-xs font-extrabold uppercase tracking-[.16em] text-[#6556e8]">Effective 22 August 2026</p>
        <h1 className="mt-3 text-4xl font-black tracking-[-0.045em] sm:text-5xl">Privacy policy</h1>
        <p className="mt-5 text-base font-medium leading-7 text-slate-600">This policy explains how PilotDesk collects and uses information when you visit our website, request a consultation or use our services.</p>

        <div className="mt-10 space-y-9 text-sm font-medium leading-7 text-slate-600">
          <section>
            <h2 className="text-xl font-extrabold text-slate-900">Information we collect</h2>
            <p className="mt-2">When you submit our contact form, we collect the details you provide, such as your name, phone number, institute name, email address, service interests and message. We may also record basic technical and campaign information, including the page URL, browser information and advertising source parameters.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-slate-900">How we use your information</h2>
            <p className="mt-2">We use this information to respond to your enquiry, provide requested information, understand which services may suit your institute, improve our website and measure campaign effectiveness. We do not sell your personal information.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-slate-900">Storage and service providers</h2>
            <p className="mt-2">Contact enquiries are stored using Firebase. We use SendGrid to send our team a notification about each new enquiry. These providers process information on our behalf to support these functions.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-slate-900">Retention and your choices</h2>
            <p className="mt-2">We retain enquiry information only as long as reasonably needed for follow-up, business records and legal obligations. You may ask us to access, correct or delete information you submitted, subject to applicable requirements.</p>
          </section>
          <section>
            <h2 className="text-xl font-extrabold text-slate-900">Contact us</h2>
            <p className="mt-2">For privacy questions or requests, email <a className="font-bold text-[#6556e8] hover:underline" href="mailto:info@pilotdesk.in">info@pilotdesk.in</a> or call <a className="font-bold text-[#6556e8] hover:underline" href="tel:+918920152023">+91 89201 52023</a>.</p>
          </section>
        </div>
      </article>
    </main>
  );
}
