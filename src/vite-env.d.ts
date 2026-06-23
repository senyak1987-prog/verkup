/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAVE_API_URL?: string;
  readonly VITE_PUSH_PUBLIC_KEY?: string;
  readonly VITE_BASE_PATH?: string;
  readonly VITE_YANDEX_MAPS_API_KEY?: string;
}

interface Window {
  VERKUP_CONFIG?: {
    YANDEX_MAPS_API_KEY?: string;
    YANDEX_GEOCODER_API_KEY?: string;
    YANDEX_GEOCODER_PROXY_URL?: string;
  };
}
