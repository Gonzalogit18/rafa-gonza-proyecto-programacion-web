import type { ReactNode } from "react";
import { Stethoscope } from "lucide-react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-[var(--sidebar)] p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Stethoscope /> MedApp
        </div>
        <div>
          <h2 className="text-4xl font-semibold leading-tight">Tu consultorio, ordenado.</h2>
          <p className="mt-4 max-w-md text-teal-50/90">
            Pacientes, historias clínicas, agenda de turnos y facturación a obras sociales en un solo lugar.
          </p>
        </div>
        <p className="text-sm text-teal-100/70">© {new Date().getFullYear()} MedApp</p>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
