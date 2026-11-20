"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "./ui";

// Para quien maneja varios profesionales: siempre se ve uno por vez
export function ProfessionalPicker({ professionals, value }: { professionals: { id: string; full_name: string }[]; value: string }) {
  const router = useRouter();
  const params = useSearchParams();
  if (professionals.length < 2) return null;
  return (
    <div className="w-60">
      <Select
        aria-label="Profesional"
        value={value}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          next.set("prof", e.target.value);
          router.push(`?${next}`);
        }}
      >
        {professionals.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
      </Select>
    </div>
  );
}
