import { getRequestConfig } from "next-intl/server";

import { getRequestLocaleValue } from "@/lib/i18n/request-locale";

export default getRequestConfig(async () => {
  const locale = await getRequestLocaleValue();

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
