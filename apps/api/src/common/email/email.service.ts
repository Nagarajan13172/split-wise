import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { loadEnv } from '../../config/env.js';

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly smtp: Transporter | null;
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor() {
    const env = loadEnv();
    this.from = env.EMAIL_FROM;

    if (env.RESEND_API_KEY) {
      this.resend = new Resend(env.RESEND_API_KEY);
      this.smtp = null;
      this.log.log('Email transport: Resend');
    } else if (env.SMTP_HOST) {
      this.smtp = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 1025,
        secure: env.SMTP_SECURE,
        // For local Mailpit / MailHog (port 1025, no TLS), don't try STARTTLS upgrade.
        ignoreTLS: !env.SMTP_SECURE,
        requireTLS: env.SMTP_SECURE,
        auth: env.SMTP_USER
          ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' }
          : undefined,
      });
      this.resend = null;
      this.log.log(`Email transport: SMTP (${env.SMTP_HOST}:${env.SMTP_PORT ?? 1025})`);
    } else {
      this.smtp = null;
      this.resend = null;
      this.log.warn('No email transport configured — emails will be logged only.');
    }
  }

  async send(input: SendMailInput): Promise<void> {
    if (this.resend) {
      const { error } = await this.resend.emails.send({
        from: this.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      if (error) throw new Error(`Resend error: ${error.message}`);
      return;
    }
    if (this.smtp) {
      await this.smtp.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return;
    }
    this.log.warn({ msg: 'email not sent (no transport)', ...input });
  }
}
