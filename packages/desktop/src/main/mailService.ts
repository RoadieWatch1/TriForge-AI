/**
 * mailService.ts — nodemailer SMTP adapter for Phase 4 real execution
 *
 * Implements the MailSender interface expected by serviceLocator.
 * Created lazily per-send to pick up latest credentials.
 */

import type { MailOptions, MailResult } from '@triforge/engine';
import type { CredentialManager } from './credentials';

export async function sendMail(opts: MailOptions, creds: CredentialManager): Promise<MailResult> {
  const smtp = await creds.getSmtp();

  if (!smtp) {
    // Paper mode: SMTP not configured
    console.log('[mailService] PAPER MODE — no SMTP configured:', opts.subject, '→', opts.to);
    return {
      messageId: `paper-${Date.now()}`,
      accepted: Array.isArray(opts.to) ? opts.to : [opts.to],
      rejected: [],
      paperMode: true,
    };
  }

  // Dynamic require so nodemailer is only loaded when actually needed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodemailer = require('nodemailer');

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    tls: { rejectUnauthorized: false },
  });

  const info = await transporter.sendMail({
    from: smtp.fromName ? `"${smtp.fromName}" <${smtp.from}>` : smtp.from,
    to:   Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
    subject: opts.subject,
    text: opts.text ?? opts.html,
    html: opts.html,
  });

  return {
    messageId:  info.messageId ?? `sent-${Date.now()}`,
    accepted:   (info.accepted as string[]) ?? [],
    rejected:   (info.rejected as string[]) ?? [],
    paperMode:  false,
  };
}

/**
 * Factory for serviceLocator.registerMailSender().
 * Returns a function that matches the MailSender signature.
 */
export function createMailAdapter(creds: CredentialManager): (opts: MailOptions) => Promise<MailResult> {
  return (opts: MailOptions) => sendMail(opts, creds);
}
