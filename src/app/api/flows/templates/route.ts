import { accountRoute } from '@/lib/api/local-route';
import { listFlowTemplates } from '@/lib/flows/templates';
export function GET(request: Request) {
  return accountRoute(request, 'viewer', async () => ({
    templates: listFlowTemplates().map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      icon: t.icon,
      trigger_type: t.trigger_type,
      node_count: t.nodes.length,
    })),
  }));
}
