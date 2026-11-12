/**
 * One table definition per currency, built on first use and kept: amount
 * columns name the currency their totals are shown in, and a definition must
 * stay the same object between renders.
 */
export function tablePerCurrency<T>(build: (currency: string) => T): (currency: string) => T {
  const tables = new Map<string, T>();
  return (currency) => {
    let table = tables.get(currency);
    if (!table) {
      table = build(currency);
      tables.set(currency, table);
    }
    return table;
  };
}
