/** Request-scoped language for the browser prototype; never mutate renderer state. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';
import i18next from 'i18next';
import { resources } from './resources';
import { DEFAULT_LOCALE, matchLocale, type LocaleCode } from './registry';
import { describeMessage } from './messages';

const scope = new AsyncLocalStorage<LocaleCode>();
const translator = i18next.createInstance();
void translator.init({ resources, fallbackLng: DEFAULT_LOCALE, lng: DEFAULT_LOCALE, initAsync: false, interpolation: { escapeValue: false } });
export const requestLocale = () => scope.getStore() || DEFAULT_LOCALE;
export const serverTr = (key: string, params?: Record<string, unknown>): string => String(translator.t(key as never, { ...params, lng: requestLocale() } as never));
export const localeMiddleware: RequestHandler = (req, res, next) => {
  const locale = matchLocale(req.body?.locale) || (req.headers['accept-language'] || '').split(',').map((value) => matchLocale(value.split(';')[0].trim())).find(Boolean) || DEFAULT_LOCALE;
  const json = res.json.bind(res);
  res.json = (body) => {
    if (typeof body?.error === 'string') body = { ...body, ...describeMessage(body.error) };
    return json(body);
  };
  scope.run(locale, next);
};
