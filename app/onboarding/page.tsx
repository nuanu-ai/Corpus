import { redirect } from "next/navigation";

/**
 * Unified single-chat model: onboarding now happens inside the main CFO
 * chat (/assistant). A new company is detected server-side by /api/chat
 * (onboarding mode) and the chat leads with the onboarding flow, then
 * flows seamlessly into answering — no separate page, no handoff break.
 * This route just forwards anyone who lands here (e.g. post-signup) into
 * that one chat.
 *
 * Belt-and-suspenders: if an onboarding_oauth query param is present
 * (e.g. from an old bookmark or a legacy redirect), carry it forward so
 * the chat surface can still pick it up.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  // Next.js 16 passes searchParams as a Promise — must be awaited.
  searchParams?: Promise<{ onboarding_oauth?: string }>;
}) {
  const params = await searchParams;
  const oauthParam = params?.onboarding_oauth;
  if (oauthParam) {
    redirect(`/assistant?onboarding_oauth=${encodeURIComponent(oauthParam)}`);
  }
  redirect("/assistant");
}
