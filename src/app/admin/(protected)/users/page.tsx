import { prisma } from "@/lib/prisma";
import { Users, ShieldCheck, User, Calendar } from "lucide-react";

export const dynamic = "force-dynamic";

function fmtDate(d: Date) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));
}

export default async function AdminUsersPage() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, email: true, name: true, role: true, createdAt: true,
      _count: { select: { orders: true } },
    },
  });

  const adminCount = users.filter((u) => u.role === "ADMIN").length;
  const userCount  = users.filter((u) => u.role !== "ADMIN").length;

  return (
    <div className="p-8 space-y-6">
      <div>
        <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-2">USER MANAGEMENT</div>
        <h1 className="text-3xl font-black uppercase tracking-tight">Пользователи</h1>
        <p className="text-zinc-500 text-sm font-medium mt-1">Всего: {users.length}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Всего",       value: users.length, icon: Users,       color: "text-white",         bg: "bg-[#1e2a45]/50",    border: "border-[#1e2a45]"     },
          { label: "Пользователей", value: userCount,  icon: User,        color: "text-[#00b06f]",     bg: "bg-[#00b06f]/10",    border: "border-[#00b06f]/20"  },
          { label: "Администраторов", value: adminCount, icon: ShieldCheck, color: "text-amber-400",  bg: "bg-amber-500/10",    border: "border-amber-500/20"  },
        ].map(({ label, value, icon: Icon, color, bg, border }) => (
          <div key={label} className={`pixel-card border-2 ${border} p-5 flex items-center gap-4`}>
            <div className={`w-9 h-9 ${bg} border ${border} flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div>
              <div className={`text-2xl font-black ${color}`}>{value}</div>
              <div className="text-xs font-black text-zinc-500 uppercase tracking-wider">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="pixel-card border-2 border-[#1e2a45] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e2a45] bg-[#080c18]">
              <th className="text-left px-5 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider">ПОЛЬЗОВАТЕЛЬ</th>
              <th className="text-left px-5 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider hidden sm:table-cell">EMAIL</th>
              <th className="text-left px-5 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider">РОЛЬ</th>
              <th className="text-left px-5 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider hidden md:table-cell">ЗАКАЗЫ</th>
              <th className="text-left px-5 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider hidden lg:table-cell">ДАТА</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-[#1e2a45]/40 hover:bg-[#00b06f]/3 transition-colors">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 border border-[#1e2a45] bg-[#080c18] flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-zinc-600" />
                    </div>
                    <p className="font-black text-sm">{user.name ?? "—"}</p>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-sm text-zinc-400 font-medium hidden sm:table-cell">{user.email}</td>
                <td className="px-5 py-3.5">
                  <span className={`font-pixel text-[8px] px-2 py-1 border ${
                    user.role === "ADMIN"
                      ? "text-amber-400 border-amber-500/20 bg-amber-500/10"
                      : "text-[#00b06f] border-[#00b06f]/20 bg-[#00b06f]/10"
                  }`}>
                    {user.role}
                  </span>
                </td>
                <td className="px-5 py-3.5 font-black text-sm text-zinc-300 hidden md:table-cell">{user._count.orders}</td>
                <td className="px-5 py-3.5 text-xs text-zinc-500 hidden lg:table-cell whitespace-nowrap">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" />
                    {fmtDate(user.createdAt)}
                  </span>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-zinc-600 text-sm">Пользователей нет</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
