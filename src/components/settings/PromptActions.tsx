"use client";

interface PromptActionsProps {
  id: string;
  enabled: boolean;
}

export default function PromptActions({
  id,
  enabled,
}: PromptActionsProps) {

  async function togglePrompt() {

    const response = await fetch(
      "/api/admin/control-center/prompts",
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id,
        }),
      },
    );

    if (!response.ok) {
      alert("Failed to update prompt.");
      return;
    }

    window.location.reload();
  }

  return (
    <button
      onClick={togglePrompt}
      className="rounded bg-red-600 px-3 py-1 text-xs text-white"
    >
      {enabled ? "Disable" : "Enable"}
    </button>
  );
}