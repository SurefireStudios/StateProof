import { z } from 'zod';

/** Every serialized StateProof document carries this version. */
export const CURRENT_SCHEMA_VERSION = '1.0.0';

export const SchemaVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'schemaVersion must be a semver triple');

/** ISO-8601 UTC with millisecond precision, so string ordering equals time ordering. */
export const IsoTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    'timestamp must be ISO-8601 UTC with millisecond precision (e.g. 2025-03-04T09:00:00.000Z)',
  );

export const NonEmptyStringSchema = z.string().min(1);

export const EmailAddressSchema = z
  .string()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be an email address');

export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be a three-letter ISO-4217 code');

/**
 * Money is a fixed two-decimal string, not a float. Exact amount checks are a
 * core benchmark assertion type and binary floats cannot represent 125.00
 * reliably. Two decimals is a deliberate limitation of the synthetic domain
 * (see docs/decisions/0001-foundation.md).
 */
export const DecimalAmountSchema = z
  .string()
  .regex(/^-?\d+\.\d{2}$/, 'amount must be a decimal string with exactly two fraction digits');

export const MoneySchema = z
  .object({
    amount: DecimalAmountSchema,
    currency: CurrencyCodeSchema,
  })
  .strict();

export type Money = z.infer<typeof MoneySchema>;

/** Collapses `-0.00` and leading zeros so equality is textual and total. */
export function normalizeAmount(amount: string): string {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(amount);
  if (match === null) return amount;
  const [, sign = '', whole = '0', fraction = '00'] = match;
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '');
  const isZero = trimmedWhole === '0' && fraction === '00';
  return `${isZero ? '' : sign}${trimmedWhole}.${fraction}`;
}

export function moneyEquals(left: Money, right: Money): boolean {
  return left.currency === right.currency && normalizeAmount(left.amount) === normalizeAmount(right.amount);
}

export function formatMoney(money: Money): string {
  return `${normalizeAmount(money.amount)} ${money.currency}`;
}
