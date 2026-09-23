// Tremor getYAxisDomain — copied from tremorlabs/tremor.
// License: Apache 2.0 (Tremor).
// Source: https://github.com/tremorlabs/tremor/blob/main/src/utils/getYAxisDomain.ts

export const getYAxisDomain = (
  autoMinValue: boolean,
  minValue: number | undefined,
  maxValue: number | undefined
) => {
  const minDomain = autoMinValue ? 'auto' : (minValue ?? 0);
  const maxDomain = maxValue ?? 'auto';
  return [minDomain, maxDomain];
};
