import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/admin/sidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session || (session.user as any).role !== "ADMIN") {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen flex bg-[#070a14]">
      <AdminSidebar user={session.user as { name?: string | null; email?: string | null }} />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
