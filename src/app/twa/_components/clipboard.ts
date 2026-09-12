/* ─────────────────────────────────────────────────────────────────────────────
   Буфер обмена в TWA.

   Живёт отдельным модулем, потому что копируют из двух мест: карточка заказа в
   «Заказах» и блок «Первым делом» на Главной. Ветка Telegram здесь не
   перестраховка — внутри его WebView `navigator.clipboard.writeText` молча
   отклоняется (нет user-activation в понимании WebView), и без подмены на
   `execCommand` кнопка делает вид, что сработала, а буфер остаётся пустым.
   ───────────────────────────────────────────────────────────────────────── */

function fallbackCopy(text: string) {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "-9999px";
  el.style.opacity = "0";
  document.body.appendChild(el);
  el.focus();
  el.select();
  try { document.execCommand("copy"); } catch {}
  document.body.removeChild(el);
}

export function copyText(text: string) {
  if (typeof window !== "undefined" && (window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp) {
    fallbackCopy(text);
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}
