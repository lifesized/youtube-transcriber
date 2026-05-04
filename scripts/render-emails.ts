import { render } from "@react-email/components";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const EMAILS = join(ROOT, "emails");
const OUT = join(ROOT, "tmp", "email-renders");

const templates = [
  "waitlist/01-d0-welcome",
  "waitlist/02-d2-five-ways",
  "waitlist/03-d5-why",
  "waitlist/04-d9-shipped",
  "waitlist/05-d14-launch",
  "activation/01-d0-welcome",
  "activation/02a-d1-no-transcripts",
  "activation/02b-d1-llm-handoff",
  "activation/03-d3-connectors",
  "activation/04-d7-pro-intro",
  "quota/01-quota-80",
  "quota/02-quota-100",
  "quota/03-discount-d3",
  "quota/04-discount-d1",
  "quota/05-payment-failed-d0",
  "quota/06-payment-failed-d3",
  "quota/07-payment-failed-d7",
  "self-hosted/01-d0-docs",
  "self-hosted/02-d7-cloud-beta",
  "self-hosted/03-d21-newsletter-handoff",
  "newsletter/01-monthly-digest",
  "newsletter/02-reengagement-60d",
  "newsletter/03-reengagement-90d-sunset",
];

async function main() {
  await mkdir(OUT, { recursive: true });
  let pass = 0;
  let fail = 0;

  for (const t of templates) {
    try {
      const mod = await import(join(EMAILS, `${t}.tsx`));
      const Component = mod.default;
      const props = (Component.PreviewProps as Record<string, unknown>) ?? {};
      const html = await render(Component(props));
      const text = await render(Component(props), { plainText: true });
      const outPath = join(OUT, `${t}.html`);
      const txtPath = join(OUT, `${t}.txt`);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, html);
      await writeFile(txtPath, text);
      console.log(`✓ ${t} (${html.length} B html, ${text.length} B text)`);
      pass++;
    } catch (err) {
      console.error(`✗ ${t}`);
      console.error(err);
      fail++;
    }
  }

  console.log(`\n${pass}/${pass + fail} rendered → ${relative(ROOT, OUT)}/`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
