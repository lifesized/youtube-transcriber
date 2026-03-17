import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/settings/providers/reorder
 * Body: { order: string[] }  — provider IDs in desired priority order.
 *       Use "__local_whisper__" to represent local Whisper's position.
 */
export async function PATCH(request: Request) {
  try {
    const { order } = (await request.json()) as { order: string[] };
    if (!Array.isArray(order)) {
      return NextResponse.json({ error: "order must be an array" }, { status: 400 });
    }

    const updates: Promise<unknown>[] = [];

    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      if (id === "__local_whisper__") {
        // Persist local Whisper's position
        updates.push(
          prisma.setting.upsert({
            where: { key: "whisper_priority" },
            update: { value: String(i) },
            create: { key: "whisper_priority", value: String(i) },
          })
        );
      } else {
        updates.push(
          prisma.providerConfig.update({
            where: { id },
            data: { priority: i },
          })
        );
      }
    }

    await Promise.all(updates);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to reorder" },
      { status: 500 }
    );
  }
}
