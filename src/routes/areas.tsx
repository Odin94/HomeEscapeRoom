import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/areas")({
  beforeLoad: () => {
    throw redirect({ to: "/secretadmin" });
  },
});
