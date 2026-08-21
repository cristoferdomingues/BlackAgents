import { ChatPage } from "@/components/features/chat/chat-page"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[] }>
}) {
  const { agent } = await searchParams
  const selectedAgentName = Array.isArray(agent) ? agent[0] : agent
  return <ChatPage selectedAgentName={selectedAgentName} />
}
