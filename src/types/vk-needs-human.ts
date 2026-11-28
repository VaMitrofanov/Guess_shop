/** «Ждут ответа в ВК» — тип отдельно от загрузчика (`server-only`), его берёт и ТВА. */
export interface VkNeedsHuman {
  /** Сколько диалогов ждут человека. */
  total: number;
  /** С какого обращения ждёт самый давний. */
  oldestAt: string | null;
  /** Самые давние — не больше пяти. */
  items: Array<{
    vkId: string;
    name: string | null;
    wbCode: string;
    /** Что написал, одной строкой. */
    quote: string | null;
    at: string;
    /** Диалог в «Сообщениях» сообщества. */
    dialogUrl: string;
  }>;
}
