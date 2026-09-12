import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert } from "lucide-react";
import Navbar from "@/components/navbar";
import styles from "../../auth-shell.module.css";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function EmailVerifiedPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = typeof params.status === "string" ? params.status : "invalid";
  const success = status === "success";
  const message = success ? "Email подтверждён. Этот адрес теперь можно использовать для безопасного восстановления доступа." : status === "expired" ? "Срок ссылки истёк. Запросите новое письмо из личного кабинета." : status === "conflict" ? "Этот email уже связан с другим профилем. Напишите в поддержку." : "Ссылка недействительна или уже использована.";
  return <main className={styles.page}><Navbar /><div className="grid min-h-[calc(100dvh-78px)] place-items-center p-5"><section className={styles.successCard}><span className={styles.successIcon}>{success ? <CheckCircle2 size={30} /> : <CircleAlert size={30} />}</span><h1>{success ? "Email подтверждён" : "Не удалось подтвердить"}</h1><p>{message}</p><p className={styles.footer}><Link href={success ? "/dashboard" : "/login"}>{success ? "Открыть кабинет" : "Вернуться ко входу"} <ArrowRight size={14} /></Link></p></section></div></main>;
}
