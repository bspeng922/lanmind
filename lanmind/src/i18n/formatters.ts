import { currentLocale } from './core';

export const formatDate = (date: Date, options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }) =>
  new Intl.DateTimeFormat(currentLocale(), options).format(date);
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(currentLocale(), options).format(value);
export const formatRelativeTime = (value: number, unit: Intl.RelativeTimeFormatUnit) => new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' }).format(value, unit);
