import { redirect } from "next/navigation";

export default function LibraryPage() {
  redirect("/?view=library");
}
