import { createFileRoute } from "@tanstack/react-router";
import { handleCallback } from "../lib/db.server";
export const Route = createFileRoute("/api/callback")({
  server: { handlers: { POST: ({ request }) => handleCallback(request) } },
});
