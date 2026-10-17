import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/secretadmin/")({
  beforeLoad: () => {
    throw redirect({ to: "/secretadmin/sessions", replace: true });
  },
});
