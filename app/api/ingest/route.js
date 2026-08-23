import { ingestTransaction } from "@/lib/ingestTransaction";

export async function POST(request) {
  let event;
  try {
    event = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  try {
    const { saved } = await ingestTransaction(event);
    return Response.json(saved);
  } catch (err) {
    return Response.json({ error: String(err.message || err) }, { status: 500 });
  }
}
