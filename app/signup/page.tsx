import { redirect } from "next/navigation";

/**
 * Friendly /signup entry that hands off to the existing login page in
 * sign-up mode. Magic-link invites point here; we forward the invite
 * code (and any other query params) into /login so the form can pick
 * them up.
 */
export default async function SignupPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await props.searchParams;
  const next = new URLSearchParams();
  next.set("mode", "signup");
  for (const [key, value] of Object.entries(params)) {
    if (key === "mode") continue;
    if (typeof value === "string") {
      next.set(key, value);
    } else if (Array.isArray(value) && typeof value[0] === "string") {
      next.set(key, value[0]);
    }
  }
  redirect(`/login?${next.toString()}`);
}
