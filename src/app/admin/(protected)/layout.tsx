import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/admin/sidebar";
import styles from "@/components/admin/admin-shell.module.css";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const sessionUser = session?.user as ({ role?: string; name?: string | null; email?: string | null } | undefined);

  if (!sessionUser || sessionUser.role !== "ADMIN") {
    redirect("/admin/login");
  }

  return (
    <div className={styles.shell}>
      <AdminSidebar user={sessionUser} />
      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
