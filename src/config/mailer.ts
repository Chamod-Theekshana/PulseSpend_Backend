import 'dotenv/config';
import { transporter } from './nodemailer';

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const SEND_TIMEOUT_MS = 15000;

export interface MailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

const EMAIL_RE = /[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/;

/**
 * Parses a `from` value into Brevo's `{name, email}` sender shape.
 *
 * Accepts the RFC form `Name <email@host>`, a bare `email@host`, and also the
 * bracket-less `Name email@host` — nodemailer's parser tolerated that, so
 * existing .env files use it, but Brevo's JSON API needs the bare address.
 * Surrounding quotes (a common dashboard-paste mistake) are stripped too.
 */
export function parseSender(raw: string): { name?: string; email: string } {
  const cleaned = raw.trim().replace(/^["']|["']$/g, '').trim();

  // `Name <email@host>`
  const bracketed = /^(.*?)\s*<\s*([^>]+?)\s*>$/.exec(cleaned);
  if (bracketed) {
    return { name: bracketed[1].trim() || undefined, email: bracketed[2].trim() };
  }

  // `Name email@host` or a bare `email@host`
  const m = EMAIL_RE.exec(cleaned);
  if (m) {
    const name = cleaned.replace(m[0], '').trim();
    return { name: name || undefined, email: m[0] };
  }

  return { email: cleaned };
}

function senderFromEnv(): { name?: string; email: string } {
  const raw = process.env.SMTP_FROM || process.env.SMTP_USER || '';
  return parseSender(raw);
}

/**
 * Single choke point for every transactional email (signup passkey, password
 * reset OTP, support/feedback).
 *
 * Cloud hosts (Railway, Render, …) block outbound SMTP ports to prevent spam,
 * so a direct nodemailer connection just times out in production. When
 * BREVO_API_KEY is set we send over Brevo's HTTPS API instead — port 443 is
 * never blocked. Without the key we fall back to the SMTP transporter, so
 * local dev keeps working against Gmail unchanged.
 *
 * The sender address must be a *verified sender* in Brevo (Senders & IPs →
 * Senders), otherwise Brevo rejects the request with 400.
 */
export async function sendMail({ to, subject, html, replyTo }: MailOptions): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY?.trim();

  // ── Production path: Brevo HTTPS API ──
  if (apiKey) {
    const sender = senderFromEnv();
    if (!EMAIL_RE.test(sender.email)) {
      // Fail loudly and locally — Brevo's "valid sender email required" 400 is
      // too vague to debug from.
      throw new Error(
        `SMTP_FROM must contain a valid sender address (parsed "${sender.email}" from ` +
          `"${process.env.SMTP_FROM ?? ''}"). Expected e.g. PulseSpend <you@example.com>`,
      );
    }

    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: to }],
        subject,
        htmlContent: html,
        ...(replyTo ? { replyTo: { email: replyTo } } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Brevo returns a JSON error body ({code, message}) — surface it so a bad
      // key / unverified sender is obvious in the logs instead of a silent fail.
      const body = await res.text().catch(() => '');
      throw new Error(`Brevo send failed (${res.status}): ${body.slice(0, 300)}`);
    }
    return;
  }

  // ── Local dev fallback: direct SMTP ──
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
    ...(replyTo ? { replyTo } : {}),
  });
}
