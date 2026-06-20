import { ArtifactEditor } from "@/components/features/editor/artifact-editor"

export default async function Page({
  params,
}: {
  params: Promise<{ name: string }>
}) {
  const { name } = await params
  return <ArtifactEditor type="skill" name={name} />
}
