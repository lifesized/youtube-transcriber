import "dotenv/config";
import { render } from "@react-email/components";
import { Resend } from "resend";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EMAILS = join(HERE, "..", "emails");

const [, , templateArg, recipientArg] = process.argv;

if (!templateArg || !recipientArg) {
  console.error(
    "Usage: tsx scripts/send-email-test.ts <template> <recipient>\n" +
      "Example: tsx scripts/send-email-test.ts waitlist/01-d0-welcome you@example.com",
  );
  process.exit(1);
}

const apiKey = process.env.RESEND_API_KEY;
if (!apiKey) {
  console.error("RESEND_API_KEY missing in .env");
  process.exit(1);
}

const FROM =
  process.env.EMAIL_TEST_FROM ||
  "Transcribed <onboarding@resend.dev>"; // Resend's shared sender — fine for test sends only.

async function main() {
  const mod = await import(join(EMAILS, `${templateArg}.tsx`));
  const Component = mod.default;
  const props = (Component.PreviewProps as Record<string, unknown>) ?? {};
  const html = await render(Component(props));
  const text = await render(Component(props), { plainText: true });

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: recipientArg,
    subject: `[TEST] ${templateArg}`,
    html,
    text,
  });

  if (error) {
    console.error("✗ send failed:", error);
    process.exit(1);
  }
  console.log(`✓ sent ${templateArg} to ${recipientArg}`);
  console.log(`  message id: ${data?.id ?? "?"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
