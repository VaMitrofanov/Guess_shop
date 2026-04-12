/**
 * VKID SDK Type Definitions
 */

interface VKIDConfig {
  app: number;
  redirectUrl: string;
  responseMode?: 'callback' | 'redirect';
  source?: number;
  scope?: string;
}

interface VKIDOneTap {
  render(params: {
    container: HTMLElement | null;
    showAlternativeLogin?: boolean;
    contentId?: number;
    styles?: Record<string, any>;
  }): VKIDOneTap;
  on(event: string, callback: (payload: any) => void): VKIDOneTap;
}

interface VKIDSDK {
  Config: {
    init(config: VKIDConfig): void;
  };
  ConfigResponseMode: {
    Callback: 'callback';
    Redirect: 'redirect';
  };
  ConfigSource: {
    LOWCODE: number;
  };
  OneTap: new () => VKIDOneTap;
  Auth: {
    exchangeCode(code: string, deviceId: string): Promise<any>;
  };
  WidgetEvents: {
    ERROR: string;
  };
  OneTapInternalEvents: {
    LOGIN_SUCCESS: string;
  };
}

declare global {
  interface Window {
    VKIDSDK?: VKIDSDK;
  }
}

export {};
