import { fileHref } from "./file-upload";
import { cn } from "./ui";

export const initials = (name: string) =>
  name
    .replace(",", " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

// Foto de la persona, o sus iniciales si no subió ninguna
export function Avatar({ path, name, size = 36, className }: { path?: string | null; name: string; size?: number; className?: string }) {
  const box = { width: size, height: size };
  if (path)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={fileHref(path)} alt={name} style={box} className={cn("shrink-0 rounded-full object-cover", className)} />;
  return (
    <span
      style={{ ...box, fontSize: Math.max(11, Math.round(size * 0.34)) }}
      aria-label={name}
      className={cn("flex shrink-0 items-center justify-center rounded-full bg-teal-100 font-semibold text-teal-800", className)}
    >
      {initials(name)}
    </span>
  );
}
