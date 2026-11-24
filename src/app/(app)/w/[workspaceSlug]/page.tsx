import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/lib/workspace";
import { EmptyWorkspace } from "@/components/workspace/EmptyWorkspace";

export default async function WorkspaceHomePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const ctx = await getWorkspaceContext(workspaceSlug);

  const first = ctx.projects[0];
  if (first) {
    redirect(`/w/${workspaceSlug}/p/${first.slug}/backlog`);
  }

  return <EmptyWorkspace />;
}
