import { UserPlus } from "lucide-react";

/** Asesor asignado sin menú (módulo de asignación activo y rol sin permiso). */
export function AsesorSoloLectura({ etiqueta }: { etiqueta: string }) {
  return (
    <span className="inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md text-muted-foreground">
      <UserPlus className="h-3 w-3" />
      <span className="hidden sm:inline">{etiqueta}</span>
    </span>
  );
}
