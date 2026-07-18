/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BAIDU_APP_KEY?: string
  readonly VITE_BAIDU_APP_FOLDER?: string
  readonly VITE_BAIDU_REDIRECT_URI?: string
  readonly VITE_USE_MOCKS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __PIANKE_UNI_PLATFORM__: string
declare const __PIANKE_BUILD_MODE__: string
declare const __PIANKE_DEV_SERVER__: boolean

declare const plus: {
  webview: {
    create(url: string, id: string, styles: Record<string, unknown>): {
      overrideUrlLoading(
        options: Record<string, string>,
        callback: (event: { url: string }) => void
      ): void
      show(animation?: string): void
      close(animation?: string): void
    }
  }
}
