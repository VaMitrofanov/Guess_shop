import { redirect } from "next/navigation";
import AdminSidebar from "@/components/admin/sidebar";
import styles from "@/components/admin/admin-shell.module.css";
import { resolveAdminFromSession } from "@/lib/admin-access";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // A1: доступ спрашивается у единственного гейта, а не сверяется с `role` из
  // сессии. Роль в токене теперь тоже выводится, но полагаться здесь на неё
  // означало бы вторую копию правила.
  const admin = await resolveAdminFromSession();
  if (!admin) redirect("/admin/login");

  return (
    <div className={styles.shell}>
      <AdminSidebar user={{ name: admin.displayName, via: admin.via }} />
      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
