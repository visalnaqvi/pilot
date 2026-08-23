"use client";

import { FormEvent, useState } from "react";

type FormStatus = "idle" | "submitting" | "success" | "error";

const inputClass =
  "mt-2 w-full rounded-xl border border-slate-200 bg-[#fafbfe] px-4 py-3 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#6556e8] focus:bg-white focus:ring-4 focus:ring-indigo-100";

export function LandingContactForm() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    setStatus("submitting");
    setMessage("");

    try {
      const query = new URLSearchParams(window.location.search);
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          pageUrl: window.location.href,
          utmSource: query.get("utm_source") || "",
          utmMedium: query.get("utm_medium") || "",
          utmCampaign: query.get("utm_campaign") || "",
        }),
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(result.message || "We could not send your enquiry.");

      form.reset();
      setStatus("success");
      setMessage(result.message || "Thank you! Our team will call you shortly.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Something went wrong. Please call or WhatsApp us.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-label="Free consultation form">
      <div>
        <p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#6556e8]">Free consultation</p>
        <h3 className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-900">Tell us about your institute</h3>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-700">
          Your name <span className="text-rose-500">*</span>
          <input className={inputClass} name="name" autoComplete="name" required minLength={2} maxLength={80} placeholder="Enter your name" />
        </label>
        <label className="text-sm font-bold text-slate-700">
          Phone number <span className="text-rose-500">*</span>
          <input className={inputClass} name="phone" type="tel" inputMode="tel" autoComplete="tel" required minLength={7} maxLength={20} placeholder="Your best contact number" />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="text-sm font-bold text-slate-700">
          Institute name <span className="text-rose-500">*</span>
          <input className={inputClass} name="institute" autoComplete="organization" required minLength={2} maxLength={120} placeholder="Your institute" />
        </label>
        <label className="text-sm font-bold text-slate-700">
          Email address
          <input className={inputClass} name="email" type="email" autoComplete="email" maxLength={160} placeholder="you@institute.com" />
        </label>
      </div>

      <label className="block text-sm font-bold text-slate-700">
        What would help you most?
        <select className={inputClass} name="interest" defaultValue="Complete growth & management solution">
          <option>Complete growth & management solution</option>
          <option>Digital marketing & lead generation</option>
          <option>Mock tests & academic management</option>
          <option>Attendance, fees & parent portal</option>
          <option>Online payment integration</option>
        </select>
      </label>

      <label className="block text-sm font-bold text-slate-700">
        Anything else we should know?
        <textarea className={`${inputClass} min-h-24 resize-y`} name="message" maxLength={1000} placeholder="Tell us about your current challenges (optional)" />
      </label>

      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <button type="submit" disabled={status === "submitting"} className="inline-flex min-h-13 w-full items-center justify-center rounded-xl bg-[#6556e8] px-6 py-3.5 text-sm font-extrabold text-white shadow-lg shadow-indigo-200 transition hover:bg-[#5949d6] disabled:cursor-wait disabled:opacity-70">
        {status === "submitting" ? "Sending your enquiry…" : "Request my free consultation"}
      </button>

      <p className="text-center text-xs font-medium leading-5 text-slate-500">By submitting, you agree to be contacted about PilotDesk services and accept our <a className="font-bold text-[#6556e8] hover:underline" href="/privacy">privacy policy</a>. No spam, ever.</p>

      {message ? (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm font-bold ${status === "success" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{message}</p>
      ) : null}
    </form>
  );
}
