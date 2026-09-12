export type SearchMatchOrder = {
  id: string;
  wbCode: string;
  robloxUsername: string | null;
  probableNick: string | null;
  gamepassUrl: string | null;
  user: { username: string | null; name: string | null; tgId: string | null; vkId: string | null };
};

export function getOrderMatchReason(order: SearchMatchOrder, rawQuery: string) {
  const query = rawQuery.trim().replace(/^@/, "").toLocaleLowerCase("ru-RU");
  const digits = rawQuery.replace(/\D/g, "");
  if (order.wbCode.toLocaleLowerCase("ru-RU").includes(query)) return "по коду";
  if (order.id.toLocaleLowerCase("ru-RU").endsWith(query)) return "по ID заказа";
  if ([order.robloxUsername, order.probableNick].some(value => value?.toLocaleLowerCase("ru-RU").includes(query))) return "по Roblox-нику";
  if (order.gamepassUrl?.toLocaleLowerCase("ru-RU").includes(query) || (digits.length >= 4 && order.gamepassUrl?.includes(digits))) return "по gamepass ID";
  if (order.user.username?.toLocaleLowerCase("ru-RU").includes(query)) return "по @username";
  if (order.user.name?.toLocaleLowerCase("ru-RU").includes(query)) return "по имени клиента";
  if (digits.length >= 4 && (order.user.tgId?.includes(digits) || order.user.vkId?.includes(digits))) return "по ID клиента";
  return "по данным заказа";
}
