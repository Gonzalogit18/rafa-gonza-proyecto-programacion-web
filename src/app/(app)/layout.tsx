import type { ReactNode } from "react";
import { DialogProvider } from "@/components/dialog";
import { Sidebar } from "@/components/sidebar";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { profile, org } = await getSession();
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Sidebar orgName={org.name} userName={profile.full_name} role={profile.role} avatarPath={profile.avatar_path} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8"><DialogProvider>{children}</DialogProvider></main>
      </div>
    </div>
  );
}
