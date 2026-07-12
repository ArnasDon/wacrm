import PromptDialog from "@/components/settings/PromptDialog";
import PromptActions from "@/components/settings/PromptActions";

interface Prompt {
  id: string;
  name: string;
  system_prompt: string;
  provider: string;
  scope: string;
  intent: string | null;
  version: number;
  enabled: boolean;
}

async function getPrompts(): Promise<Prompt[]> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_APP_URL}/api/admin/control-center/prompts`,
    {
      cache: "no-store",
    }
  );

  const json = await res.json();

  return json.data ?? [];
}

export default async function PromptSettingsPage() {
  const prompts = await getPrompts();

  return (
    <div className="space-y-6 p-6">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-2xl font-bold">
            Prompt Manager
          </h1>

          <p className="text-sm text-muted-foreground">
            Manage AI prompts for all providers.
          </p>

        </div>

        <PromptDialog />

      </div>

      <div className="rounded-lg border overflow-hidden">

        <table className="w-full text-sm">

          <thead className="bg-muted">

            <tr>

              <th className="p-3 text-left">
                Name
              </th>

              <th className="p-3 text-left">
                Provider
              </th>

              <th className="p-3 text-left">
                Scope
              </th>

              <th className="p-3 text-left">
                Intent
              </th>

              <th className="p-3 text-center">
                Version
              </th>

              <th className="p-3 text-center">
                Enabled
              </th>

              <th className="p-3 text-center">
                Actions
              </th>

            </tr>

          </thead>

          <tbody>

            {prompts.map((prompt) => (

              <tr
                key={prompt.id}
                className="border-t"
              >

                <td className="p-3">
                  {prompt.name}
                </td>

                <td className="p-3">
                  {prompt.provider}
                </td>

                <td className="p-3">
                  {prompt.scope}
                </td>

                <td className="p-3">
                  {prompt.intent ?? "-"}
                </td>

                <td className="p-3 text-center">
                  {prompt.version}
                </td>

                <td className="p-3 text-center">
                  {prompt.enabled ? "✅" : "❌"}
                </td>

                <td className="p-3 text-center">

  <div className="flex items-center justify-center gap-2">

    <PromptDialog
      prompt={prompt}
    />

    <PromptActions
      id={prompt.id}
      enabled={prompt.enabled}
    />

  </div>

</td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

    </div>
  );
}