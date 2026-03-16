import { redirect } from "next/navigation";

export default async function TranscriptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/?id=${encodeURIComponent(id)}`);
}
