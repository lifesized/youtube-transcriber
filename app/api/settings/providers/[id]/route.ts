import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyTuskLlmChanged } from "@/lib/electron-ipc.js";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.providerConfig.delete({ where: { id } });
    await notifyTuskLlmChanged();
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete provider" },
      { status: 500 }
    );
  }
}
