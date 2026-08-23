import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { adminFirestore } from "@/lib/firebase-admin";
import { sendEmail } from "@/lib/email";
import { getBrandConfig } from "@/lib/branding";

export const runtime = "nodejs";

const leadSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(20).regex(/^[+()\-\s0-9]+$/),
  institute: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.string().trim().email().max(160)]).default(""),
  interest: z.string().trim().max(160).default("Complete growth & management solution"),
  message: z.string().trim().max(1000).default(""),
  website: z.string().max(200).default(""),
  pageUrl: z.string().max(1000).default(""),
  utmSource: z.string().max(160).default(""),
  utmMedium: z.string().max(160).default(""),
  utmCampaign: z.string().max(200).default(""),
});

const recentRequests = new Map<string, number[]>();
const rateWindowMs = 10 * 60 * 1000;
const rateLimit = 5;

function isRateLimited(key: string) {
  const now = Date.now();
  const recent = (recentRequests.get(key) || []).filter((time) => now - time < rateWindowMs);
  recent.push(now);
  recentRequests.set(key, recent);
  return recent.length > rateLimit;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

export async function POST(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const requestKey = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  if (isRateLimited(requestKey)) {
    return Response.json({ message: "Too many enquiries were sent. Please call or WhatsApp us." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: "Please check the form and try again." }, { status: 400 });
  }

  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ message: "Please enter a valid name, phone number and institute." }, { status: 400 });
  }

  const { website, ...lead } = parsed.data;
  if (website) return Response.json({ message: "Thank you! Our team will call you shortly." }, { status: 201 });

  try {
    const document = await adminFirestore.collection("landingPageLeads").add({
      ...lead,
      status: "new",
      source: "pilotdesk-landing-page",
      createdAt: FieldValue.serverTimestamp(),
      userAgent: request.headers.get("user-agent") || "",
      emailNotification: "pending",
    });

    const rows = [
      ["Name", lead.name],
      ["Phone", lead.phone],
      ["Institute", lead.institute],
      ["Email", lead.email || "Not provided"],
      ["Interested in", lead.interest],
      ["Message", lead.message || "Not provided"],
      ["UTM source", lead.utmSource || "Not provided"],
      ["UTM medium", lead.utmMedium || "Not provided"],
      ["UTM campaign", lead.utmCampaign || "Not provided"],
    ];
    const text = rows.map(([label, value]) => `${label}: ${value}`).join("\n");
    const html = `
      <div style="font-family:Arial,sans-serif;color:#101828;max-width:640px;margin:auto">
        <div style="background:#6556e8;color:#fff;padding:24px;border-radius:16px 16px 0 0">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;opacity:.8">PilotDesk website</div>
          <h1 style="font-size:24px;margin:8px 0 0">New consultation enquiry</h1>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:0;padding:24px;border-radius:0 0 16px 16px">
          ${rows.map(([label, value]) => `<p style="margin:0 0 14px"><strong>${escapeHtml(label)}:</strong><br>${escapeHtml(value)}</p>`).join("")}
          <p style="margin:22px 0 0;color:#667085;font-size:12px">Lead ID: ${document.id}</p>
        </div>
      </div>`;

    try {
      const hostBrand = getBrandConfig(request.headers.get("host"));
      const delivery = await sendEmail({
        to: "visalnaqvi@gmail.com",
        subject: `New PilotDesk enquiry — ${lead.institute}`,
        text,
        html,
        metadata: { leadId: document.id, source: "landing-page" },
        brand: {
          ...hostBrand,
          name: "PilotDesk",
          email: { fromAddress: "info@pilotdesk.in", fromName: "PilotDesk" },
        },
      });
      await document.update({
        emailNotification: "sent",
        emailProviderMessageId: delivery.providerMessageId || "",
        emailSentAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error("Landing lead email notification failed", error);
      await document.update({
        emailNotification: "failed",
        emailError: error instanceof Error ? error.message.slice(0, 500) : "Unknown email error",
      });
    }

    return Response.json({ message: "Thank you! Our team will call you shortly." }, { status: 201 });
  } catch (error) {
    console.error("Landing lead submission failed", error);
    return Response.json({ message: "We could not save your enquiry. Please call or WhatsApp us." }, { status: 503 });
  }
}
