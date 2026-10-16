import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/play")({
  beforeLoad: ({ location }) => {
    throw redirect({ href: "/" + location.searchStr });
  },
});
