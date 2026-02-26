interface Window {
  __MY_WEB_DEBUGGER_INSTALLED__?: boolean;
  __MY_WEB_DEBUGGER_TEST__?: {
    formatBody: (value: unknown, context?: { item?: { type?: string } }) => string;
  };
}

interface XMLHttpRequest {
  __MWD_id?: string;
  __MWD_method?: string;
  __MWD_url?: string;
}
