"use client";

import { useState } from "react";
import PromptForm, {
  PromptFormValues,
} from "./PromptForm";

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

interface PromptDialogProps {
  prompt?: Prompt;
}

export default function PromptDialog({
  prompt,
}: PromptDialogProps) {

  const [open, setOpen] = useState(false);

  async function handleSubmit(
    values: PromptFormValues,
  ) {

    const response = await fetch(
      "/api/admin/control-center/prompts",
      {
        method: prompt ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: prompt?.id,
          name: values.name,
          provider: values.provider,
          scope: values.scope,
          intent: values.intent || null,
          systemPrompt: values.systemPrompt,
          enabled: true,
        }),
      },
    );

    if (!response.ok) {
      alert("Failed to save prompt.");
      return;
    }

    alert(
      prompt
        ? "Prompt updated successfully."
        : "Prompt created successfully.",
    );

    window.location.reload();
  }

  return (
    <>

      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
      >
        {prompt ? "Edit" : "+ Create Prompt"}
      </button>

      {open && (

        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">

          <div className="w-full max-w-3xl rounded-lg bg-white p-6">

            <div className="mb-6 flex items-center justify-between">

              <h2 className="text-xl font-semibold">

                {prompt
                  ? "Edit Prompt"
                  : "Create Prompt"}

              </h2>

              <button
                onClick={() => setOpen(false)}
                className="text-gray-500"
              >
                ✕
              </button>

            </div>

            <PromptForm
              initialValues={
                prompt
                  ? {
                      name: prompt.name,
                      provider: prompt.provider,
                      scope: prompt.scope,
                      intent: prompt.intent ?? "",
                      systemPrompt: prompt.system_prompt,
                    }
                  : undefined
              }
              onSubmit={handleSubmit}
            />

          </div>

        </div>

      )}

    </>
  );
}