"use client";

import { useState } from "react";

export interface PromptFormValues {
  name: string;
  provider: string;
  scope: string;
  intent: string;
  systemPrompt: string;
}

interface PromptFormProps {
  initialValues?: PromptFormValues;
  onSubmit?: (values: PromptFormValues) => Promise<void>;
}

export default function PromptForm({
  initialValues,
  onSubmit,
}: PromptFormProps) {

  const [values, setValues] = useState<PromptFormValues>(
    initialValues ?? {
      name: "",
      provider: "gemini",
      scope: "global",
      intent: "",
      systemPrompt: "",
    }
  );

  async function handleSubmit(
    e: React.FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();

    if (onSubmit) {
      await onSubmit(values);
      return;
    }

    const response = await fetch(
      "/api/admin/control-center/prompts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: values.name,
          provider: values.provider,
          scope: values.scope,
          intent: values.intent || null,
          systemPrompt: values.systemPrompt,
        }),
      },
    );

    if (!response.ok) {
      alert("Failed to save prompt.");
      return;
    }

    alert("Prompt saved successfully.");

    window.location.reload();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      <input
        className="w-full rounded border p-2"
        placeholder="Prompt Name"
        value={values.name}
        onChange={(e) =>
          setValues({
            ...values,
            name: e.target.value,
          })
        }
      />

      <select
        className="w-full rounded border p-2"
        value={values.provider}
        onChange={(e) =>
          setValues({
            ...values,
            provider: e.target.value,
          })
        }
      >
        <option value="gemini">Gemini</option>
        <option value="openai">OpenAI</option>
        <option value="claude">Claude</option>
        <option value="deepseek">DeepSeek</option>
        <option value="grok">Grok</option>
      </select>

      <select
        className="w-full rounded border p-2"
        value={values.scope}
        onChange={(e) =>
          setValues({
            ...values,
            scope: e.target.value,
          })
        }
      >
        <option value="global">Global</option>
        <option value="account">Account</option>
        <option value="intent">Intent</option>
      </select>

      <input
        className="w-full rounded border p-2"
        placeholder="Intent (optional)"
        value={values.intent}
        onChange={(e) =>
          setValues({
            ...values,
            intent: e.target.value,
          })
        }
      />

      <textarea
        rows={12}
        className="w-full rounded border p-2"
        placeholder="System Prompt"
        value={values.systemPrompt}
        onChange={(e) =>
          setValues({
            ...values,
            systemPrompt: e.target.value,
          })
        }
      />

      <button
        type="submit"
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
      >
        Save Prompt
      </button>
    </form>
  );
}