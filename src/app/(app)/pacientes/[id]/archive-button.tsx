"use client";

import { useTransition } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { useDialog } from "@/components/dialog";
import { buttonClass } from "@/components/ui";
import { setPatientArchived } from "../actions";

export function ArchivePatientButton({ id, archived }: { id: string; archived: boolean }) {
  const [pending, start] = useTransition();
  const { ask } = useDialog();
  return (
    <button
      disabled={pending}
      className={buttonClass("ghost")}
      onClick={async () => {
        if (archived || (await ask("¿Archivar este paciente? No se borra nada: lo podés restaurar desde Archivados.", "Archivar")))
          start(() => setPatientArchived(id, !archived));
      }}
    >
      {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />} {archived ? "Restaurar" : "Archivar"}
    </button>
  );
}
