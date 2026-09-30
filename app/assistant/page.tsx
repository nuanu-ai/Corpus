import { ChatV2 } from "./_components/chat-v2";

function readParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0].trim() || null;
  }
  return null;
}

export default async function CorpusChatV2Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const initialPrompt = readParam(params.prompt);
  const sourceDocumentId = readParam(params.sourceDocumentId);

  return (
    <div className="h-full">
      <ChatV2
        initialPrompt={initialPrompt}
        initialPromptLabel={sourceDocumentId ? "Question from document" : null}
      />
    </div>
  );
}
