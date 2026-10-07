import { WorkflowBuilder } from "@/components/features/workflows/workflow-builder"

export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  return <WorkflowBuilder name={name} />
}
