import { redirect } from "next/navigation";

export default function TranscriptPage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/?id=${encodeURIComponent(params.id)}`);
}
