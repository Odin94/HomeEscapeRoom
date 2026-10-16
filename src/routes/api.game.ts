import { createFileRoute } from "@tanstack/react-router";
import { handle } from "../lib/db.server";
export const Route = createFileRoute("/api/game")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
