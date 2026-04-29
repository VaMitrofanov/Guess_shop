"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Shield, Wifi } from "lucide-react";

type State = "detecting" | "vpn-on" | "vpn-off";

const TG_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 flex-shrink-0">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8-1.7 8.02c-.12.55-.46.68-.94.42l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.53.26l.19-2.67 4.85-4.38c.21-.19-.05-.29-.32-.1L7.12 14.4l-2.55-.8c-.55-.17-.56-.55.12-.82l9.97-3.84c.46-.17.86.11.98.86z" />
  </svg>
);

const VK_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 flex-shrink-0">
    <path d="M12.785 16.241s.288-.032.435-.194c.135-.149.13-.43.13-.43s-.019-1.306.572-1.497c.582-.188 1.331 1.252 2.124 1.806.6.42 1.056.328 1.056.328l2.122-.03s1.111-.07.585-.957c-.043-.073-.306-.658-1.578-1.853-1.331-1.252-1.153-1.049.451-3.224.977-1.323 1.367-2.13 1.245-2.474-.116-.328-.834-.241-.834-.241l-2.387.015s-.177-.024-.308.056c-.128.078-.21.262-.21.262s-.378 1.022-.882 1.892c-1.062 1.834-1.487 1.931-1.661 1.816-.405-.267-.304-1.069-.304-1.638 0-1.778.267-2.519-.51-2.711-.258-.064-.448-.106-1.108-.113-.847-.009-1.564.003-1.97.207-.27.136-.479.439-.351.456.157.022.514.099.703.363.244.341.236 1.108.236 1.108s.14 2.083-.328 2.342c-.32.178-.76-.185-1.706-1.85-.484-.853-.85-1.795-.85-1.795s-.07-.176-.196-.27c-.152-.114-.365-.15-.365-.15l-2.268.015s-.34.01-.466.16c-.111.135-.009.412-.009.412s1.776 4.221 3.787 6.349c1.844 1.95 3.938 1.822 3.938 1.822h.949z" />
  </svg>
);

function Card({
  icon,
  label,
  hint,
  highlighted,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  highlighted: boolean;
  color: string; // hex accent
}) {
  const ring = highlighted
    ? `border-[${color}]/60 bg-[${color}]/15 shadow-[0_0_12px_${color}22]`
    : `border-[${color}]/20 bg-[${color}]/5`;

  return (
    <div
      className={`flex items-center gap-2.5 px-3 py-2.5 border flex-1 transition-all ${ring}`}
      style={
        highlighted
          ? {
              borderColor: `${color}99`,
              background: `${color}1a`,
              boxShadow: `0 0 14px ${color}22`,
            }
          : {
              borderColor: `${color}33`,
              background: `${color}0d`,
            }
      }
    >
      <span style={{ color: highlighted ? color : `${color}66` }}>{icon}</span>
      <div className="flex flex-col min-w-0">
        <span
          className="font-black text-[10px] uppercase tracking-widest leading-none"
          style={{ color: highlighted ? "#fff" : "#666" }}
        >
          {label}
        </span>
        <span
          className="text-[9px] font-semibold mt-0.5 leading-none"
          style={{ color: highlighted ? color : "#555" }}
        >
          {hint}
        </span>
      </div>
    </div>
  );
}

export function ConnectivityAssistant() {
  const [state, setState] = useState<State>("detecting");

  useEffect(() => {
    const controller = new AbortController();
    fetch("https://ipapi.co/json/", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data: { country_code?: string }) => {
        setState(data.country_code !== "RU" ? "vpn-on" : "vpn-off");
      })
      .catch(() => {
        // Treat fetch failure as "outside RU / VPN on"
        setState("vpn-on");
      });
    return () => controller.abort();
  }, []);

  if (state === "detecting") return null;

  const isVpnOn = state === "vpn-on";

  const tgCard = (
    <Card
      key="tg"
      icon={TG_ICON}
      label="Telegram"
      hint={isVpnOn ? "VPN полезен ✓" : "Может нужен VPN"}
      highlighted={isVpnOn}
      color="#229ED9"
    />
  );

  const vkCard = (
    <Card
      key="vk"
      icon={VK_ICON}
      label="ВКонтакте"
      hint={isVpnOn ? "Лучше без VPN" : "Работает отлично ✓"}
      highlighted={!isVpnOn}
      color="#0077FF"
    />
  );

  const accentColor = isVpnOn ? "#229ED9" : "#0077FF";

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="relative z-10 max-w-2xl mx-auto w-full mb-4"
    >
      <div
        className="border px-4 pt-3 pb-3.5"
        style={{
          borderColor: `${accentColor}22`,
          background: `${accentColor}08`,
        }}
      >
        {/* Header row */}
        <div className="flex items-center gap-2 mb-2">
          {isVpnOn ? (
            <Shield
              className="w-3.5 h-3.5 flex-shrink-0"
              style={{ color: accentColor }}
            />
          ) : (
            <Wifi
              className="w-3.5 h-3.5 flex-shrink-0"
              style={{ color: accentColor }}
            />
          )}
          <span
            className="font-black text-[9px] uppercase tracking-[0.22em]"
            style={{ color: accentColor }}
          >
            {isVpnOn ? "VPN активен" : "Прямое соединение"}
          </span>
          <span className="font-pixel text-[8px] text-zinc-600 ml-auto tracking-wide">
            {isVpnOn ? "🛡️ Помощник доступа" : "✅ Соединение в норме"}
          </span>
        </div>

        {/* Body */}
        <p className="text-[11px] text-zinc-400 font-medium leading-relaxed mb-3">
          {isVpnOn
            ? "Мы позаботились о каждой детали. VPN помогает Telegram стабильнее работать в РФ — вы в выигрыше. ВКонтакте, напротив, иногда блокирует авторизацию через VPN, поэтому для VK лучше его отключить."
            : "Всё отлично — прямое соединение идеально для ВКонтакте. Если бот Telegram не открывается сразу, попробуйте включить VPN или прокси: Telegram в некоторых регионах РФ работает только через него."}
        </p>

        {/* Status cards */}
        <div className="flex gap-2">
          {isVpnOn ? [tgCard, vkCard] : [vkCard, tgCard]}
        </div>
      </div>
    </motion.div>
  );
}
