import { notFound } from "next/navigation";

import { ChatV2 } from "../_components/chat-v2";
import {
  isPersonaSlug,
  PERSONA_CONFIG,
  type PersonaSlug,
} from "@/lib/ai/personas";

interface PersonaPageProps {
  params: Promise<{ persona: string }>;
}

export default async function CorpusChatPersonaPage({ params }: PersonaPageProps) {
  const { persona: personaParam } = await params;
  if (!isPersonaSlug(personaParam)) {
    notFound();
  }
  const slug: PersonaSlug = personaParam;
  const config = PERSONA_CONFIG[slug];
  // Personal lives at /personal/chat with its own runtime; refuse here.
  if (!config.visibleInCompanySidebar) {
    notFound();
  }

  return (
    <div className="h-full">
      <ChatV2
        surface="company"
        persona={slug === "company" ? undefined : slug}
      />
    </div>
  );
}
